import { clsx } from 'clsx';
import { IconButton } from '../components/button';
import { ImBackward2, ImPause2, ImPlay3 } from 'react-icons/im';
import { useCallback, useMemo, useEffect, useState, useRef, useContext } from 'react';
import { MediaFile } from './api_document';
import { CssRule } from '../utils/cssdom';
import { SEEK_TO_EVENT, SeekToEvent } from './types';
import { useEvent } from '../utils/use_event';
import { Editor } from 'slate';
import { useButtonHoldRepeat } from '../utils/button_hooks';
import { useLocalStorage } from '../utils/use_local_storage';
import { SpeakerColorsContext } from './speaker_colors';
import { LoadingSpinner } from '../components/loading_spinner/loading_spinner';
import { getSpeakerName, useDocumentSelector } from '../utils/document';
import { sortMediaFiles, useAudio } from '../utils/use_audio';
import { formattedTime } from './transcription_editor';
import { IconType } from 'react-icons';
import { BiVideo, BiVideoOff } from 'react-icons/bi';

const DOUBLE_TAP_THRESHOLD_MS = 250;
const SKIP_BUTTON_SEC = 2;
const SKIP_SHORTCUT_SEC = 3;

let lastTabPressTs = 0;

export function splitAndSortMediaFiles(mediaFiles: MediaFile[]) {
  const videoFiles = mediaFiles.filter(
    (media) => !media.tags.includes('waveform') && media.tags.includes('video'),
  );
  const audioFiles = mediaFiles.filter(
    (media) => !media.tags.includes('waveform') && !media.tags.includes('video'),
  );
  const waveformFiles = mediaFiles.filter((media) => media.tags.includes('waveform'));

  const mapFile = (media: (typeof mediaFiles)[0]) => {
    return {
      src: media.url,
      type: media.content_type,
      tags: media.tags,
    };
  };

  const mappedVideoFiles = videoFiles.map(mapFile);
  const mappedAudioFiles = audioFiles.map(mapFile);

  return {
    videoSources: sortMediaFiles(mappedVideoFiles),
    audioSources: sortMediaFiles(mappedAudioFiles),
    hasVideo: videoFiles.length > 0,
    waveformSource: waveformFiles[0],
  };
}

export function PlayerBar({
  documentId,
  editor,
  onShowVideo,
  mediaFiles,
}: {
  documentId: string;
  editor: Editor;
  onShowVideo?: (show: boolean) => void;
  mediaFiles: MediaFile[];
}) {
  const { videoSources, audioSources, hasVideo, waveformSource } = useMemo(
    () => splitAndSortMediaFiles(mediaFiles),
    [mediaFiles],
  );

  const [playbackRate, setPlaybackRate] = useLocalStorage('playbackRate', 1);

  const [showVideo, setShowVideo] = useState(true);
  const reallyShowVideo = showVideo && hasVideo;

  const audio = useAudio({
    playbackRate,
    sources: reallyShowVideo ? videoSources : audioSources,
    videoPreview: reallyShowVideo,
    documentId,
  });

  useEffect(() => {
    if (onShowVideo) {
      onShowVideo(reallyShowVideo);
    }
  }, [reallyShowVideo]);

  // calculate the start of the current element to color it
  const [currentElementStartTime, setCurrentElementStartTime] = useState(0.0);

  useEffect(() => {
    const time = audio.playtime || 0;
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
  }, [editor.doc, audio.playtime]);

  // skip to a timestamp if the user clicks on a word in the transcript. The corresponding event is
  // dispatched in transcription_editor.tsx
  useEvent<SeekToEvent>(SEEK_TO_EVENT, (e) => {
    if (e.detail.start != undefined) {
      // move a bit into the word to avoid highlighting the previous word because of rounding errors
      audio.setPlaytime(e.detail.start + 1e-6);
    }
  });

  // bind the tab key to play / pause
  const togglePlaying = () => {
    if (!audio.playing) {
      audio.play();
    } else {
      audio.pause();
    }
  };

  useEvent<KeyboardEvent>('keydown', (e) => {
    if (e.key == 'Tab') {
      // double tap to skip
      if (e.timeStamp - lastTabPressTs < DOUBLE_TAP_THRESHOLD_MS) {
        if (e.shiftKey) {
          audio.seekRelative(SKIP_SHORTCUT_SEC);
        } else {
          audio.seekRelative(-SKIP_SHORTCUT_SEC);
        }
      }

      lastTabPressTs = e.timeStamp;

      togglePlaying();
      e.stopPropagation();
      e.preventDefault();
    }
  });

  const backwardLongPressProps = useButtonHoldRepeat({
    repeatingAction: () => audio.seekRelative(-SKIP_BUTTON_SEC / 2),
    onShortClick: () => audio.seekRelative(-SKIP_BUTTON_SEC),
  });

  const forwardLongPressProps = useButtonHoldRepeat({
    repeatingAction: () => audio.seekRelative(SKIP_BUTTON_SEC / 2),
    onShortClick: () => audio.seekRelative(SKIP_BUTTON_SEC),
  });

  const onSeek = useCallback(
    (time: number) => {
      audio.setPlaytime(time);
    },
    [audio],
  );

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
          'fixed bottom-0 inset-x-6 mx-auto z-20',
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
        <PlayButton playing={audio.playing} buffering={audio.buffering} onClick={togglePlaying} />
        <IconButton
          icon={ImBackward2}
          iconClassName="translate-x-0.5 rotate-180"
          label="forwards"
          {...forwardLongPressProps}
        />

        <div className="pl-4 flex-grow">
          <SeekBar
            time={audio.playtime}
            duration={audio.duration}
            onSeek={onSeek}
            editor={editor}
          />
          <WaveformViewer source={waveformSource} time={audio.playtime} />
        </div>

        <PlaybackSpeedDropdown value={playbackRate} onChange={setPlaybackRate} />
        {hasVideo && (
          <IconButton
            icon={reallyShowVideo ? BiVideoOff : BiVideo}
            label={reallyShowVideo ? 'disable video preview' : 'enable video preview'}
            onClick={() => setShowVideo(!reallyShowVideo)}
          />
        )}
      </div>
    </>
  );
}

class WaveformReader {
  version: number;
  resolution: number;
  sampleRate: number;
  samplesPerPixel: number;
  length: number;
  channels: number;
  data: Int8Array | Int16Array;

  constructor(buffer: ArrayBuffer) {
    const dv = new DataView(buffer);
    this.version = dv.getInt32(0, true);
    const flags = dv.getUint32(4, true);
    this.resolution = flags & 0x1 ? 8 : 16;
    this.sampleRate = dv.getInt32(8, true);
    this.samplesPerPixel = dv.getInt32(12, true);
    this.length = dv.getUint32(16, true);
    if (this.version >= 2) {
      this.channels = dv.getInt32(20, true);
    } else {
      this.channels = 1;
    }

    const self = this;
    const readData = function* (dv: DataView, length: number) {
      let offset = 24;
      while (offset + 2 < length * self.channels * 4) {
        yield dv.getInt16(offset, true);
        offset += 2;
      }
    };

    if (this.resolution == 8) {
      this.data = new Int8Array(buffer.slice(24));
    } else if (this.resolution == 16) {
      this.data = new Int16Array(readData(dv, this.length));
    } else {
      throw new Error(`Invalid waveform resolution: ${this.resolution}`);
    }
  }
}

function renderWaveform(reader: WaveformReader) {
  const offscreenCanvas = new OffscreenCanvas(reader.length, 100);
  const ctx = offscreenCanvas.getContext('2d')!;

  console.time('render_waveform');
  ctx.clearRect(0, 0, 1000, 1000);

  const zoom = 1;
  let min = 0;
  ctx.lineWidth = 1;

  const maxVal = 2 ** (reader.resolution - 1);
  ctx.beginPath();
  reader.data.forEach((sample, i) => {
    sample = sample / maxVal;
    if (i % 2 == 0) {
      min = sample;
    } else {
      ctx.moveTo((i / 2) * zoom, 50 - min * 50);
      ctx.lineTo((i / 2) * zoom, 50 - sample * 50);
    }
  });
  ctx.closePath();
  ctx.stroke();

  console.timeEnd('render_waveform');

  return offscreenCanvas;
}
function WaveformViewer({ source, time }: { source: MediaFile | null; time: number }) {
  async function getData(media: MediaFile) {
    const res = await fetch(media.url);
    const buffer = await res.arrayBuffer();
    return new WaveformReader(buffer);
  }

  const [reader, setReader] = useState<WaveformReader>(null);
  useEffect(() => {
    if (!source) return;
    getData(source).then((reader) => {
      setReader(reader);
    });
  }, [source]);

  const canvasRef = useRef<HTMLCanvasElement>(null);

  const waveform = useMemo(() => {
    if (!reader) return;
    return renderWaveform(reader);
  }, [reader]);

  const [pos, setPos] = useState<number>(0);

  useEffect(() => {
    console.time('render_waveform2');
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx || !reader) return;

    const update = () => {
      const zoom = 1;

      const waveformOffset = ((-pos * reader.sampleRate) / reader.samplesPerPixel) * zoom;

      ctx.clearRect(0, 0, 1000, 1000);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(waveform, waveformOffset, 0, waveform.width * zoom, waveform.height);

      ctx.strokeStyle = 'red';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(((time * reader.sampleRate) / reader.samplesPerPixel) * zoom + waveformOffset, 0);
      ctx.lineTo(
        ((time * reader.sampleRate) / reader.samplesPerPixel) * zoom + waveformOffset,
        100,
      );
      ctx.closePath();
      ctx.stroke();
    };

    update();
  }, [reader, time, pos]);

  const [dragging, setDragging] = useState(false);

  const onDrag = useCallback(
    (e: MouseEvent | React.MouseEvent) => {
      // if (!ref.current || !duration) return;

      // const time = timeFromPosition(ref.current, e.pageX, duration);
      // setTmpTime(time);
      setPos((x) => x - (e.movementX / reader.sampleRate) * reader.samplesPerPixel);
    },
    [dragging],
  );

  useEffect(() => {
    if (!dragging) return;

    // globally listen to mouse move events to allow dragging outside of the bar
    window.addEventListener('mousemove', onDrag);

    const onMouseUp = () => {
      setDragging(false);
    };
    window.addEventListener('mouseup', onMouseUp);

    return () => {
      window.removeEventListener('mousemove', onDrag);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [dragging]);

  return (
    <canvas
      onMouseDown={() => {
        setDragging(true);
      }}
      ref={canvasRef}
      width="1000"
      height="100"
      className="bg-gray-100"
    />
  );
}

function PlayButton({
  onClick,
  playing,
  buffering,
}: {
  onClick: () => void;
  playing: boolean;
  buffering: boolean;
}) {
  const timeoutRef = useRef<NodeJS.Timeout>(null);
  const [delayedBuffering, setDelayedBuffering] = useState(false);

  useEffect(() => {
    if (buffering) {
      timeoutRef.current = setTimeout(() => {
        setDelayedBuffering(true);
      }, 500);
    } else {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      setDelayedBuffering(false);
    }
  }, [buffering]);

  const Icon: IconType = useCallback(() => {
    return (
      <div className="grid justify-items-center items-center">
        {delayedBuffering && <LoadingSpinner className="col-start-1 row-start-1" size={28} />}
        {!delayedBuffering && (
          <div
            className={clsx(
              'col-start-1 row-start-1',
              'border-2 border-black dark:border-white',
              'w-[28px] h-[28px]',
              'rounded-full',
            )}
          />
        )}
        {playing && <ImPause2 className="col-start-1 row-start-1" size={14} />}
        {!playing && (
          <ImPlay3
            className="col-start-1 row-start-1"
            style={{ transform: `translateX(1px)` }}
            size={16}
          />
        )}
      </div>
    );
  }, [delayedBuffering, playing]);

  return <IconButton icon={Icon} label={playing ? 'pause' : 'play'} onClick={onClick} />;
}

const timeFromPosition = (element: HTMLElement, x: number, duration: number) => {
  const boundingRect = element.getBoundingClientRect();
  const seekToPercent = (x - boundingRect.x) / boundingRect.width;
  const clampedPercent = Math.max(0, Math.min(seekToPercent, 1.0));
  return clampedPercent * duration;
};

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
  const [hover, setHover] = useState(false);
  const [hoverTime, setHoverTime] = useState<number>(0);

  const onDrag = useCallback(
    (e: MouseEvent | React.MouseEvent) => {
      if (!ref.current || !duration) return;

      const time = timeFromPosition(ref.current, e.pageX, duration);
      setTmpTime(time);
    },
    [duration],
  );

  useEffect(() => {
    if (!dragging) return;

    // globally listen to mouse move events to allow dragging outside of the seek bar
    window.addEventListener('mousemove', onDrag);

    const onMouseUp = (e: MouseEvent) => {
      if (!ref.current || !duration) return;

      const time = timeFromPosition(ref.current, e.pageX, duration);
      onSeek(time);

      setTmpTime(undefined);
      setDragging(false);
    };
    window.addEventListener('mouseup', onMouseUp);

    return () => {
      window.removeEventListener('mousemove', onDrag);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [dragging, onSeek, duration]);

  const paragraphs = useDocumentSelector(
    (doc) => {
      return (
        doc.children?.map((p) => ({
          speaker: p.speaker,
          start: p.children[0]?.start || 0,
          end: p.children[p.children.length - 1]?.end || 0,
        })) || []
      );
    },
    {
      eq: (a, b) => JSON.stringify(a) === JSON.stringify(b),
      editor,
    },
  );

  const speakerColors = useContext(SpeakerColorsContext);

  return (
    <div
      ref={ref}
      className={clsx('relative', 'h-6', 'flex', 'items-center', 'select-none')}
      onMouseDown={(e) => {
        onDrag(e);
        setDragging(true);
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onMouseMove={(e) => {
        if (!ref.current || !duration) return;
        setHoverTime(timeFromPosition(ref.current, e.pageX, duration));
      }}
    >
      <div className="absolute h-2 w-full overflow-hidden rounded-md bg-gray-200 dark:bg-gray-600">
        {duration
          ? paragraphs.map((p, i) => (
              <SpeakerBar
                key={i}
                start={p.start}
                end={p.end}
                speakerName={getSpeakerName(p.speaker, editor.doc.speaker_names)}
                color={p.speaker && speakerColors[p.speaker]}
                duration={duration}
              />
            ))
          : null}
      </div>

      <PlayPositionIndicator currentTime={time} seekTime={tmpTime} duration={duration} />

      {(hover || dragging) && duration && (
        <TimeMarker time={tmpTime != undefined ? tmpTime : hoverTime} duration={duration} />
      )}
    </div>
  );
}

function SpeakerBar({
  speakerName,
  color,
  start,
  end,
  duration,
}: {
  speakerName: string;
  color: string | undefined | null;
  start: number;
  end: number;
  duration: number;
}) {
  const width = (end - start) / duration;
  const left = start / duration;

  return (
    <div
      className="absolute h-full"
      title={speakerName}
      style={{
        background: color || 'transparent',
        left: `${left * 100}%`,
        width: `${width * 100}%`,
      }}
    />
  );
}

function PlayPositionIndicator({
  currentTime,
  seekTime,
  duration,
}: {
  currentTime: number;
  seekTime: number | undefined;
  duration: number | undefined;
}) {
  return (
    <div
      className={clsx(
        'absolute',
        'w-[2px]',
        'bg-black',
        'dark:bg-white',
        'h-full',
        '-ml-[1px]',
        'rounded-sm',
      )}
      style={
        duration
          ? {
              left: ((seekTime !== undefined ? seekTime : currentTime) / duration) * 100 + '%',
            }
          : {}
      }
    />
  );
}

function TimeMarker({ time, duration }: { time: number; duration: number }) {
  return (
    <div
      style={{ left: `${(time / duration) * 100}%` }}
      className="absolute w-0 flex bottom-7 justify-center"
    >
      <div
        className={clsx('px-2 py-1', 'bg-neutral-100 dark:bg-neutral-800', 'rounded-lg', 'text-sm')}
      >
        {formattedTime(time)}
      </div>
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
