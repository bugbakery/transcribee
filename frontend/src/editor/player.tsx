import clsx from 'clsx';
import { IconButton } from '../components/button';
import { ImPause, ImPlay2, ImBackward2 } from 'react-icons/im';
import { useCallback, useMemo, useEffect, useState, useRef } from 'react';
import { audio, actions, events } from '@podlove/html5-audio-driver';
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

  const player = useMemo(() => {
    const element = audio(
      data?.media_files.map((file) => {
        return {
          src: file.url,
          type: file.content_type,
        };
      }) || [],
    );

    return {
      element,
      actions: actions(element),
      events: events(element),
    };
  }, [data?.media_files]);

  const [duration, setDuration] = useState<number | undefined>();
  useEffect(() => {
    setDuration(player.element.duration);
    player.events.onDurationChange(() => {
      setDuration(player.element.duration);
    });

    player.events.onPlay(() => {
      setPlayingState(true);
    });

    player.events.onPause(() => {
      setPlayingState(false);
    });
  }, [player]);

  // state for knowing which symbol we should display at the play / pause button
  const [playing, setPlayingState] = useState(false);

  useEffect(() => {
    if (playing) {
      player.actions.play();
    } else {
      player.actions.pause();
    }
  }, [playing]);
  const [playbackRate, setPlaybackRate] = useLocalStorage('playbackRate', 1);
  useEffect(() => {
    player.actions.setRate(playbackRate);
  }, [playbackRate]);

  // calculate the start of the current element to color it
  const [currentElementStartTime, setCurrentElementStartTime] = useState(0.0);
  const [currentTime, setCurrentTime] = useState(0.0);
  const progressCallback = useCallback(() => {
    const time = player.element.currentTime;
    let startTimeOfElement = 0;

    setCurrentTime(time);

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
  }, [editor.doc]);

  useEffect(() => {
    player.events.onPlaytimeUpdate(progressCallback);
  }, [player, progressCallback]);

  // skip to a timestamp if the user clicks on a word in the transcript. The corresponding event is
  // dispatched in transcription_editor.tsx
  useEvent<SeekToEvent>(SEEK_TO_EVENT, (e) => {
    if (e.detail.start != undefined) {
      player.actions.setPlaytime(e.detail.start);
    }
  });

  // bind the tab key to play / pause
  const togglePlaying = () => {
    setPlayingState(!playing);
  };

  const seekRelative = (seconds: number) => {
    player.actions.setPlaytime(player.element.currentTime + seconds);
  };

  useEvent<KeyboardEvent>('keydown', (e) => {
    if (e.key == 'Tab') {
      // double tap to skip
      if (e.timeStamp - lastTabPressTs < DOUBLE_TAP_THRESHOLD_MS) {
        if (e.shiftKey) {
          seekRelative(SKIP_SHORTCUT_SEC);
        } else {
          seekRelative(-SKIP_SHORTCUT_SEC);
        }
      }

      lastTabPressTs = e.timeStamp;

      togglePlaying();
      e.stopPropagation();
      e.preventDefault();
    }
  });

  const backwardLongPressProps = useButtonHoldRepeat({
    repeatingAction: () => seekRelative(-SKIP_BUTTON_SEC / 2),
    onShortClick: () => seekRelative(-SKIP_BUTTON_SEC),
  });

  const forwardLongPressProps = useButtonHoldRepeat({
    repeatingAction: () => seekRelative(SKIP_BUTTON_SEC / 2),
    onShortClick: () => seekRelative(SKIP_BUTTON_SEC),
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
          {duration && (
            <SeekBar
              time={currentTime}
              duration={duration}
              setTime={(time) => {
                setCurrentTime(time);
                player.actions.setPlaytime(time);
              }}
            />
          )}
        </div>

        <PlaybackSpeedDropdown value={playbackRate} onChange={setPlaybackRate} />
      </div>

      <div className="pb-24" />
    </>
  );
}

function SeekBar({
  time,
  duration,
  setTime,
}: {
  time: number;
  duration: number;
  setTime: (time: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [tmpTime, setTmpTime] = useState<number | undefined>();

  const onMouseSeek = useCallback((e: MouseEvent) => {
    if (!ref.current) return;
    const boundingRect = ref.current.getBoundingClientRect();
    const seekToPercent = (e.pageX - boundingRect.x) / boundingRect.width;
    const clampedPercent = Math.max(0, Math.min(seekToPercent, 1.0));

    setTime(clampedPercent * duration);
    setTmpTime(undefined);
  }, []);

  const onMouseMove = useCallback((e: MouseEvent | React.MouseEvent) => {
    if (!ref.current) return;
    const boundingRect = ref.current.getBoundingClientRect();
    const seekToPercent = (e.pageX - boundingRect.x) / boundingRect.width;
    const clampedPercent = Math.max(0, Math.min(seekToPercent, 1.0));

    setTmpTime(clampedPercent * duration);
  }, []);

  const onMouseDown = useCallback((e: MouseEvent | React.MouseEvent) => {
    onMouseMove(e);
    setDragging(true);
  }, []);

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

  return (
    <div
      ref={ref}
      className={clsx('bg-gray-600', 'h-4', 'w-full', 'relative', 'rounded-sm')}
      onMouseDown={onMouseDown}
    >
      <div
        className={clsx('absolute', 'w-[2px]', 'bg-white', '-top-1 -bottom-1 -ml-0.5')}
        style={{
          transform: `translateX(${
            ((tmpTime !== undefined ? tmpTime : time) / duration) *
            (ref.current?.getBoundingClientRect().width || 0)
          }px)`,
        }}
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
