import clsx from 'clsx';
import { IconButton } from '../components/button';
import { ImBackward2, ImPause2, ImPlay3 } from 'react-icons/im';
import { useCallback, useMemo, useEffect, useState, useRef, useContext } from 'react';
import { useGetDocument } from '../api/document';
import { CssRule } from '../utils/cssdom';
import { SEEK_TO_EVENT, SeekToEvent } from './types';
import { useEvent } from '../utils/use_event';
import { Editor } from 'slate';
import { useButtonHoldRepeat } from '../utils/button_hooks';
import { useLocalStorage } from '../utils/use_local_storage';
import { SpeakerColorsContext } from './speaker_colors';
import { LoadingSpinner } from '../components/loading_spinner';
import { getSpeakerName } from '../utils/document';
import { useAudio } from '../utils/use_audio';
import { minutesInMs } from '../utils/duration_in_ms';

const DOUBLE_TAP_THRESHOLD_MS = 250;
const SKIP_BUTTON_SEC = 2;
const SKIP_SHORTCUT_SEC = 3;

let lastTabPressTs = 0;

export function PlayerBar({ documentId, editor }: { documentId: string; editor: Editor }) {
  const { data } = useGetDocument(
    { document_id: documentId },
    {
      revalidateOnFocus: false,
      refreshInterval: minutesInMs(50), // media token expires after 1 hour
    },
  );

  const [playbackRate, setPlaybackRate] = useLocalStorage('playbackRate', 1);

  const sources = useMemo(
    () =>
      data?.media_files.map((media) => {
        return {
          src: media.url,
          type: media.content_type,
        };
      }) || [],
    [data?.media_files],
  );

  const audioPlayer = useAudio({
    playbackRate,
    sources,
  });

  // calculate the start of the current element to color it
  const [currentElementStartTime, setCurrentElementStartTime] = useState(0.0);

  useEffect(() => {
    const time = audioPlayer.playtime || 0;
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

    setCurrentElementStartTime(startTimeOfElement);
  }, [editor.doc, audioPlayer.playtime]);

  // skip to a timestamp if the user clicks on a word in the transcript. The corresponding event is
  // dispatched in transcription_editor.tsx
  useEvent<SeekToEvent>(SEEK_TO_EVENT, (e) => {
    if (e.detail.start != undefined) {
      audioPlayer.setPlaytime(e.detail.start + 1e-6);
    }
  });

  // bind the tab key to play / pause
  const togglePlaying = () => {
    if (!audioPlayer.playing) {
      audioPlayer.play();
    } else {
      audioPlayer.pause();
    }
  };

  useEvent<KeyboardEvent>('keydown', (e) => {
    if (e.key == 'Tab') {
      // double tap to skip
      if (e.timeStamp - lastTabPressTs < DOUBLE_TAP_THRESHOLD_MS) {
        if (e.shiftKey) {
          audioPlayer.seekRelative(SKIP_SHORTCUT_SEC);
        } else {
          audioPlayer.seekRelative(-SKIP_SHORTCUT_SEC);
        }
      }

      lastTabPressTs = e.timeStamp;

      togglePlaying();
      e.stopPropagation();
      e.preventDefault();
    }
  });

  const backwardLongPressProps = useButtonHoldRepeat({
    repeatingAction: () => audioPlayer.seekRelative(-SKIP_BUTTON_SEC / 2),
    onShortClick: () => audioPlayer.seekRelative(-SKIP_BUTTON_SEC),
  });

  const forwardLongPressProps = useButtonHoldRepeat({
    repeatingAction: () => audioPlayer.seekRelative(SKIP_BUTTON_SEC / 2),
    onShortClick: () => audioPlayer.seekRelative(SKIP_BUTTON_SEC),
  });

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
        <BufferingPlayButton
          playing={audioPlayer.playing}
          buffering={audioPlayer.buffering}
          onClick={togglePlaying}
        />
        <IconButton
          icon={ImBackward2}
          iconClassName="translate-x-0.5 rotate-180"
          label="forwards"
          {...forwardLongPressProps}
        />

        <div className="pl-4 flex-grow">
          <SeekBar
            time={audioPlayer.playtime}
            duration={audioPlayer.duration}
            onSeek={(time) => {
              audioPlayer.setPlaytime(time);
            }}
            editor={editor}
          />
        </div>

        <PlaybackSpeedDropdown value={playbackRate} onChange={setPlaybackRate} />
      </div>

      <div className="pb-24" />
    </>
  );
}

function BufferingPlayButton({
  onClick,
  playing,
  buffering,
}: {
  onClick: () => void;
  playing: boolean;
  buffering: boolean;
}) {
  const timeoutRef = useRef<NodeJS.Timeout>();
  const [delayedBuffering, setDelayedBuffering] = useState(false);

  useEffect(() => {
    if (buffering) {
      timeoutRef.current = setTimeout(() => {
        setDelayedBuffering(true);
      }, 500);
    } else {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = undefined;
      }
      setDelayedBuffering(false);
    }
  }, [buffering]);

  return (
    <IconButton
      icon={playing ? (delayedBuffering ? LoadingSpinner : ImPause2) : ImPlay3}
      label={playing ? 'pause' : 'play'}
      size={28}
      onClick={onClick}
    />
  );
}

function SeekBar({
  time,
  duration,
  onSeek,
  editor,
}: {
  time: number;
  duration: number | undefined;
  onSeek: (time: number) => void;
  editor: Editor;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [tmpTime, setTmpTime] = useState<number | undefined>();

  const onMouseSeek = useCallback(
    (e: MouseEvent) => {
      if (!ref.current || !duration) return;
      const boundingRect = ref.current.getBoundingClientRect();
      const seekToPercent = (e.pageX - boundingRect.x) / boundingRect.width;
      const clampedPercent = Math.max(0, Math.min(seekToPercent, 1.0));

      onSeek(clampedPercent * duration);
      setTmpTime(undefined);
    },
    [duration],
  );

  const onMouseMove = useCallback(
    (e: MouseEvent | React.MouseEvent) => {
      if (!ref.current || !duration) return;
      const boundingRect = ref.current.getBoundingClientRect();
      const seekToPercent = (e.pageX - boundingRect.x) / boundingRect.width;
      const clampedPercent = Math.max(0, Math.min(seekToPercent, 1.0));

      setTmpTime(clampedPercent * duration);
    },
    [duration],
  );

  const onMouseDown = useCallback(
    (e: MouseEvent | React.MouseEvent) => {
      onMouseMove(e);
      setDragging(true);
    },
    [onMouseMove],
  );

  useEffect(() => {
    if (!dragging) return;

    window.addEventListener('mousemove', onMouseMove);

    const onMouseUp = (e: MouseEvent) => {
      onMouseSeek(e);
      setDragging(false);
    };
    window.addEventListener('mouseup', onMouseUp);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [dragging, onMouseSeek]);

  const speakerColors = useContext(SpeakerColorsContext);

  return (
    <div
      ref={ref}
      className={clsx('relative', 'h-6', 'flex', 'items-center', 'select-none')}
      onMouseDown={onMouseDown}
    >
      <div className="absolute h-2 w-full overflow-hidden rounded-md bg-gray-600">
        {duration && editor.doc.children
          ? editor.doc.children.map((p, i) => {
              const width =
                ((p.children[p.children.length - 1]?.end || 0) - (p.children[0]?.start || 0)) /
                duration;
              const left = (p.children[0]?.start || 0) / duration;

              return (
                <div
                  className={clsx(
                    'absolute h-full',
                    // width * (barWidth || 0) > 4 && 'border-l-2 first:border-l-0 border-gray-600',
                  )}
                  title={getSpeakerName(p.speaker, editor.doc.speaker_names)}
                  data-start={p.children[0]?.start}
                  data-end={p.children[p.children.length - 1]?.end}
                  style={{
                    background: (p.speaker && speakerColors[p.speaker]) || 'transparent',
                    left: `${left * 100}%`,
                    width: `${width * 100}%`,
                  }}
                  key={i}
                />
              );
            })
          : null}
      </div>
      <div
        className={clsx('absolute', 'w-[2px]', 'bg-white', 'h-full', '-ml-[1px]')}
        style={
          duration
            ? {
                left: ((tmpTime !== undefined ? tmpTime : time) / duration) * 100 + '%',
              }
            : {}
        }
      />
    </div>
  );
}

// helper function to create class names for highlighting words when clicking on the transcript
export function startTimeToClassName(startTime: number) {
  return `start-${startTime.toFixed(3).replace('.', '')}`;
}

function PlaybackSpeedDropdown({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const possibleRates = [0.5, 0.7, 1.0, 1.2, 1.5, 1.7, 2.0];

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
