import clsx from 'clsx';
import { IconButton } from '../components/button';
import { ImPause, ImPlay2, ImBackward2 } from 'react-icons/im';
import { useCallback, useEffect, useRef, useState } from 'react';
import { WaveSurfer, WaveForm } from 'wavesurfer-react';
import WaveSurferType from 'wavesurfer.js';
import { useGetDocument } from '../api/document';
import { CssRule } from '../utils/cssdom';
import { SEEK_TO_EVENT, SeekToEvent } from './types';
import { useEvent } from '../utils/use_event';
import { Editor } from 'slate';
import { useButtonHoldRepeat } from '../utils/button_hooks';
import { useLocalStorage } from '../utils/use_local_storage';

const DOUBLE_TAP_THRESHOLD_MS = 250;
const SKIP_BUTTON_SEC = 2;
const SKIP_SHORTCUT_SEC = 3;

let lastTabPressTs = 0;

export function PlayerBar({ documentId, editor }: { documentId: string; editor: Editor }) {
  const { data } = useGetDocument({ document_id: documentId });
  let audioFile = data?.media_files[0]?.url;
  const audioElement = document.createElement('audio');
  data?.media_files.forEach((media_file) => {
    if (
      media_file.tags.indexOf('original') == -1 &&
      audioElement.canPlayType(media_file.content_type) == 'probably'
    ) {
      audioFile = media_file.url;
    }
  });

  // state for knowing which symbol we should display at the play / pause button
  const [playing, setPlayingState] = useState(false);

  // handle the waveSurfer mounting
  const waveSurferRef = useRef<WaveSurferType | undefined>();
  const handleWSMount = useCallback(
    (ws: WaveSurferType | null) => {
      if (!ws) return;
      waveSurferRef.current = ws;

      if (ws && audioFile) {
        ws.load(audioFile);
        ws.setHeight(40);

        ws.on('play', () => setPlayingState(true));
        ws.on('pause', () => setPlayingState(false));
      }
    },
    [audioFile],
  );

  // calculate the start of the current element to color it
  const [currentElementStartTime, setCurrentElementStartTime] = useState(0.0);
  const progressCallback = useCallback(() => {
    const time = waveSurferRef.current?.getCurrentTime() || 0;
    let startTimeOfElement = 0;

    if (!editor.doc.children) return;

    // we loop from the back to the front to get the first element that is no longer too far
    // (if no text is at the current time, we highlight the text before)
    outer: for (let i = editor.doc.children.length - 1; i >= 0; i--) {
      const paragraph = editor.doc.children[i];
      if ('children' in paragraph) {
        for (let j = paragraph.children.length - 1; j >= 0; j--) {
          const word = paragraph.children[j];
          if (word.start && word.start - 1e-10 <= time) {
            startTimeOfElement = word.start;
            break outer;
          }
        }
      }
    }

    console.log(time)
    setCurrentElementStartTime(startTimeOfElement);
  }, [editor.doc]);

  useEffect(() => {
    waveSurferRef.current?.on('seek', progressCallback);
    waveSurferRef.current?.on('audioprocess', progressCallback);
    waveSurferRef.current?.drawer.on('click', progressCallback);
    return () => {
      waveSurferRef.current?.un('seek', progressCallback);
      waveSurferRef.current?.un('audioprocess', progressCallback);
      waveSurferRef.current?.drawer.un('click', progressCallback);
    };
  }, [waveSurferRef.current, progressCallback]);

  // skip to a timestamp if the user clicks on a word in the transcript. The corresponding event is
  // dispatched in transcription_editor.tsx
  useEvent<SeekToEvent>(SEEK_TO_EVENT, (e) => {
    if (e.detail.start != undefined) {
      console.log(e.detail.start)
      window.wave = waveSurferRef.current;
      waveSurferRef.current?.setCurrentTime(e.detail.start);
    }
  });

  // bind the tab key to play / pause
  const togglePlaying = () => {
    if (waveSurferRef.current) {
      if (!playing) {
        waveSurferRef.current.play();
      } else {
        waveSurferRef.current.pause();
      }
    }
  };
  useEvent<KeyboardEvent>('keydown', (e) => {
    if (e.key == 'Tab') {
      // double tap to skip
      if (e.timeStamp - lastTabPressTs < DOUBLE_TAP_THRESHOLD_MS) {
        if (e.shiftKey) {
          waveSurferRef.current?.skipForward(SKIP_SHORTCUT_SEC);
        } else {
          waveSurferRef.current?.skipBackward(SKIP_SHORTCUT_SEC);
        }
      }

      lastTabPressTs = e.timeStamp;

      togglePlaying();
      e.stopPropagation();
      e.preventDefault();
    }
  });

  const backwardLongPressProps = useButtonHoldRepeat({
    repeatingAction: () => waveSurferRef.current?.skipBackward(SKIP_BUTTON_SEC / 2),
    onShortClick: () => waveSurferRef.current?.skipBackward(SKIP_BUTTON_SEC),
  });

  const forwardLongPressProps = useButtonHoldRepeat({
    repeatingAction: () => waveSurferRef.current?.skipForward(SKIP_BUTTON_SEC / 2),
    onShortClick: () => waveSurferRef.current?.skipForward(SKIP_BUTTON_SEC),
  });

  const setPlaybackRate = useCallback(
    (v: number) => waveSurferRef.current?.setPlaybackRate(v),
    [waveSurferRef.current],
  );

  // if we don't know the path of the audio file yet, we can't start to render
  if (!audioFile) return <></>;

  return (
    <>
      {/* inject rules to highlight the current word  */}
      <CssRule
        css={`
          .${startTimeToClassName(currentElementStartTime)} {
            border-radius: 3px;
            background: var(--transcribee-word-highlight-color);
          }
        `}
      />

      <div
        className={clsx(
          'fixed bottom-0 inset-x-6 mx-auto z-50',
          'max-w-screen-xl height-8 my-2',
          'flex',
          'p-2',
          'bg-white dark:bg-neutral-900',
          'border-black dark:border-neutral-200',
          'border-2',
          'shadow-brutal',
          'shadow-slate-400 dark:shadow-neutral-600',
          'rounded-lg',
          'items-center',
        )}
      >
        <IconButton
          icon={ImBackward2}
          iconClassName="-translate-x-0.5"
          label="backwards"
          {...backwardLongPressProps}
        />
        <IconButton
          icon={playing ? ImPause : ImPlay2}
          label="play / pause"
          size={28}
          onClick={() => togglePlaying()}
        />
        <IconButton
          icon={ImBackward2}
          iconClassName="translate-x-0.5 rotate-180"
          label="forwards"
          {...forwardLongPressProps}
        />

        <div className="pl-4 flex-grow">
          <WaveSurfer onMount={handleWSMount}>
            <WaveForm
              id="waveform"
              cursorColor="red"
              barWidth={2}
              normalize
              responsive={true}
              hideScrollbar={true}
              backend="MediaElement"
            />
          </WaveSurfer>
        </div>

        <PlaybackSpeedDropdown onChange={setPlaybackRate} />
      </div>

      <div className="pb-24" />
    </>
  );
}

// helper function to create class names for highlighting words when clicking on the transcript
export function startTimeToClassName(startTime: number) {
  return `start-${startTime.toFixed(3).replace('.', '')}`;
}

function PlaybackSpeedDropdown({ onChange }: { onChange: (v: number) => void }) {
  const possibleRates = [0.5, 0.7, 1.0, 1.2, 1.5, 1.7, 2.0, 2.2, 2.5, 2.7, 3.0];

  const [value, setValue] = useLocalStorage('playbackSpeed', 1.0);
  useEffect(() => {
    onChange(value);
  }, [onChange]);

  return (
    <select
      value={value.toFixed(1)}
      className={clsx(
        'tabular-nums text-sm font-semibold',
        'p-2 ml-2 rounded-lg',
        'appearance-none bg-none border-none focus:ring-0',
        'hover:bg-gray-200',
        'dark:bg-transparent dark:hover:bg-neutral-700',
      )}
      onChange={(v) => {
        const r = parseFloat(v.target.value);
        onChange(r);
        setValue(r);
      }}
    >
      {possibleRates.map((r) => (
        <option key={r} value={r.toFixed(1)}>
          {r.toFixed(1)}&times;
        </option>
      ))}
    </select>
  );
}
