import { clsx } from 'clsx';
import {
  useState,
  useRef,
  useCallback,
  useEffect,
  useContext,
  useMemo,
  MouseEventHandler,
} from 'react';
import { Editor, Transforms } from 'slate';
import { useDocumentSelector } from '../utils/document';
import { MediaFile } from './api_document';
import { SpeakerColorsContext } from './speaker_colors';
import { WaveformRenderer } from './waveform_renderer';
import { WaveformReader } from './waveform_reader';
import { useMediaQuery } from '../utils/use_media_query';
import { useResizeObserver } from '../utils/use_resize_observer';
import { Paragraph, Text } from './types';
import { useSize } from '../utils/use_size';
import { clamp } from '../utils/math';

type DragHandle = {
  type: 'paragraph' | 'paragraphStart' | 'paragraphEnd';
  startX: number;
  paragraph: ParagraphWithInfos;
};

type ParagraphWithInfos = Paragraph & {
  idx: number;
  start: number;
  end: number;
};

function adjustParagraphTs(
  editor: Editor,
  p: ParagraphWithInfos,
  { newLength, moveBy = 0 }: { newLength?: number; moveBy?: number },
) {
  let scaleRatio = 1;
  if (newLength != undefined) {
    if (newLength <= 0.1) {
      newLength = 0.1;
    }

    // TODO: handle 0 length
    const oldLength = p.end - p.start;
    scaleRatio = newLength / oldLength;
  }

  Editor.withoutNormalizing(editor, () => {
    p.children.forEach((child, i) => {
      const update: Partial<Text> = {
        conf_ts: 1.0, // manually set timestamps get maximum confidence
      };
      if (child.start != undefined) {
        update.start = p.start + (child.start - p.start) * scaleRatio + moveBy;
      }
      if (child.end != undefined) {
        update.end = p.start + (child.end - p.start) * scaleRatio + moveBy;
      }
      console.assert(
        update.start == undefined || update.end == undefined || update.start <= update.end,
      );
      Transforms.setNodes(editor, update, { at: [p.idx, i] });
    });
  });
}

export function AlignmentEditor({
  waveformSource,
  editor,
  time,
  onSeek,
  playing,
  onSetPlaying: onTogglePlay,
}: {
  waveformSource: MediaFile | null;
  editor: Editor;
  time: number;
  onSeek: (t: number) => void;
  playing: boolean;
  onSetPlaying: (playing: boolean) => void;
}) {
  const [viewportStartSec, setViewportStartSec] = useState<number>(0);
  const samplesPerSecond = 16_000 / 128;
  const [pxPerSec, setPxPerSec] = useState(100.0);

  const containerRef = useRef<HTMLDivElement>(null);
  const speakerColors = useContext(SpeakerColorsContext);
  const [dragHandle, setDragHandle] = useState<DragHandle | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>();
  const containerSize = useSize(containerRef.current);

  const px2sec = useCallback(
    (pixels: number) => {
      return pixels / pxPerSec;
    },
    [pxPerSec],
  );

  const sec2px = useCallback(
    (seconds: number) => {
      return seconds * pxPerSec;
    },
    [pxPerSec],
  );

  const paragraphs: ParagraphWithInfos[] = useDocumentSelector(
    (doc) => {
      return (
        doc.children?.map((p, i) => ({
          ...p,
          idx: i,
          start: p.children[0]?.start || 0,
          end: p.children[p.children.length - 1]?.end || 0,
        })) || []
      );
    },
    {
      eq: (a, b) => JSON.stringify(a) == JSON.stringify(b),
      editor,
    },
  );
  const VISIBILITY_MARGIN = 200;
  const visibleParagraphs = paragraphs.filter((p) => {
    return (
      p.start < viewportStartSec + px2sec((containerSize?.width || 0) + VISIBILITY_MARGIN) &&
      p.end > viewportStartSec - px2sec(VISIBILITY_MARGIN)
    );
  });

  // logic to seek to a position with animation
  const seekTarget = useRef<{
    startPos: number;
    startTime: number;
    targetPos: number;
    targetTime: number;
  }>(null);
  const animatedSetViewportStartSec = (targetPos: number) => {
    if (seekTarget.current != null) return;
    const startTime = Date.now();
    const targetTime = startTime + 200;
    const startPos = viewportStartSec;
    seekTarget.current = { startPos, startTime, targetPos, targetTime };
    const update = () => {
      if (seekTarget.current == null) return;
      const totalDuration = seekTarget.current.targetTime - seekTarget.current.startTime;
      const elapsed = Date.now() - seekTarget.current.startTime;
      const distance = seekTarget.current.targetPos - seekTarget.current.startPos;
      if (Date.now() < seekTarget.current.targetTime) {
        setViewportStartSec((elapsed / totalDuration) * distance + seekTarget.current.startPos);
        requestAnimationFrame(update);
      } else {
        setViewportStartSec(seekTarget.current.targetPos);
        seekTarget.current = null;
      }
    };
    requestAnimationFrame(update);
  };

  // keep the cursor in viewport (generally)
  // the view gets decoupled when one pans manually and it gets coupled again when
  // * the user seeks to a different position manually
  // * the user starts playing
  const [isDecoupled, setIsDecoupled] = useState(false);
  useEffect(() => {
    if (!containerSize || isDecoupled || !playing || seekTarget.current != null) return;
    const viewportEndSec = viewportStartSec + px2sec(containerSize.width);
    const marginSec = px2sec(containerSize.width) * 0.07;
    if (time > viewportEndSec - marginSec) {
      if (dragHandle != null) {
        setIsDecoupled(true);
        return;
      }
      setViewportStartSec(time - marginSec);
    } else if (time < viewportStartSec) {
      setViewportStartSec(time - marginSec);
    }
  }, [time, containerSize, viewportStartSec, px2sec, isDecoupled, playing, dragHandle]);

  // re-couple on play
  const lastPlaying = useRef(false);
  useEffect(() => {
    if (lastPlaying.current == false && playing == true) {
      setIsDecoupled(false);
    }
    lastPlaying.current = playing;
  }, [playing]);

  // re-couple on large seeks
  const lastTime = useRef(0.0);
  useEffect(() => {
    if (!containerSize) return;
    const viewportEndSec = viewportStartSec + px2sec(containerSize.width);
    const marginSec = px2sec(containerSize.width) * 0.07;
    if (
      (time > viewportEndSec || time < viewportStartSec) &&
      Math.abs(lastTime.current - time) > 1.0
    ) {
      setIsDecoupled(false);
      animatedSetViewportStartSec(time - marginSec);
    }
    lastTime.current = time;
  }, [time, containerSize, px2sec, viewportStartSec]);

  // handle scrolling
  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;

    const listener = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();

      let deltaMultiplier = 1;
      switch (e.deltaMode) {
        case 0: // pixel mode
          deltaMultiplier = 1;
          break;
        case 1: // "line" mode
          deltaMultiplier = 20;
          break;
        case 2: // "page" mode
          deltaMultiplier = 500;
          break;
        default:
          console.warn(`Unknown deltaMode received: ${e.deltaMode}`);
      }
      setViewportStartSec((x) => x + e.deltaX * px2sec(deltaMultiplier));
      setIsDecoupled(true);
      const canvasBoundingRect = c.getBoundingClientRect();
      if (e.ctrlKey) {
        const newPxPerSec = clamp(pxPerSec - sec2px(e.deltaY * deltaMultiplier * 0.01), 20, 600);
        setPxPerSec(newPxPerSec);

        const oldMouseX = (e.clientX - canvasBoundingRect.x) / pxPerSec;
        const newMouseX = (e.clientX - canvasBoundingRect.x) / newPxPerSec;
        setViewportStartSec((x) => x + oldMouseX - newMouseX);
      }
    };

    c.addEventListener('wheel', listener, { passive: false });

    return () => {
      c.removeEventListener('wheel', listener);
    };
  }, [px2sec, pxPerSec, sec2px]);

  // handle dragging
  useEffect(() => {
    if (!dragHandle) return;

    // globally listen to mouse move events to allow dragging outside of the canvas
    const onHandleDrag = (e: MouseEvent) => {
      setMousePos({ x: e.clientX, y: e.clientY });
    };
    window.addEventListener('mousemove', onHandleDrag);

    const onMouseUp = () => {
      if (mousePos) {
        const relativeSecs = px2sec(mousePos.x - dragHandle.startX);
        const p = dragHandle.paragraph;
        const oldLength = p.end - p.start;

        if (dragHandle.type == 'paragraph') {
          adjustParagraphTs(editor, p, { moveBy: relativeSecs });
        } else if (dragHandle.type == 'paragraphStart') {
          adjustParagraphTs(editor, p, {
            newLength: oldLength - relativeSecs,
            moveBy: relativeSecs,
          });
        } else if (dragHandle.type == 'paragraphEnd') {
          adjustParagraphTs(editor, p, { newLength: oldLength + relativeSecs });
        }
      }

      setDragHandle(null);
      setMousePos(null);
    };
    window.addEventListener('mouseup', onMouseUp);

    return () => {
      window.removeEventListener('mousemove', onHandleDrag);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [dragHandle, mousePos, editor, px2sec]);

  // handle clicking to seek
  const preSeekPlayingState = useRef<boolean | null>(null);
  const handleSeek = useCallback(
    (e: React.MouseEvent) => {
      if (dragHandle) return;

      if (e.buttons & 1) {
        if (preSeekPlayingState.current == null) {
          preSeekPlayingState.current = playing;
          onTogglePlay(false);
        }
        const clickTime =
          px2sec(e.clientX - e.currentTarget.getBoundingClientRect().x) + viewportStartSec;
        onSeek(clickTime);
      }
    },
    [dragHandle, viewportStartSec, px2sec, onSeek, onTogglePlay, playing],
  );
  const restorePlayingState = useCallback(
    (_e: React.MouseEvent) => {
      if (preSeekPlayingState.current == null) {
        return;
      }
      onTogglePlay(preSeekPlayingState.current);
      preSeekPlayingState.current = null;
    },
    [onTogglePlay],
  );

  return (
    <div ref={containerRef}>
      <div
        className="h-[85px] relative overflow-hidden -mb-14"
        onMouseDown={handleSeek}
        onMouseMove={handleSeek}
        onMouseUp={restorePlayingState}
      >
        <div
          className="absolute w-[2px] bottom-0 top-[25px] bg-red-500"
          style={{ left: sec2px(time - viewportStartSec) }}
        />
        {visibleParagraphs.map((p) => {
          let dragging = false;

          // handle temporary adjustments while dragging
          if (dragHandle && mousePos && dragHandle.paragraph.idx == p.idx) {
            dragging = true;
            const offset = px2sec(mousePos.x - dragHandle.startX);
            switch (dragHandle.type) {
              case 'paragraphStart':
                p = {
                  ...p,
                  start: p.start + offset,
                  children: p.children.map((c) => ({
                    ...c,
                    start: c.start + offset,
                    end: c.end + offset,
                  })),
                };
                break;
              case 'paragraphEnd':
                p = {
                  ...p,
                  end: p.end + px2sec(mousePos.x - dragHandle.startX),
                  children: p.children.map((c) => ({
                    ...c,
                    start: c.start + offset,
                    end: c.end + offset,
                  })),
                };
                break;
              case 'paragraph':
                p = {
                  ...p,
                  start: p.start + px2sec(mousePos.x - dragHandle.startX),
                  end: p.end + px2sec(mousePos.x - dragHandle.startX),
                  children: p.children.map((c) => ({
                    ...c,
                    start: c.start + offset,
                    end: c.end + offset,
                  })),
                };
                break;
            }
          }

          return (
            <div
              key={p.idx}
              style={{
                left: sec2px(p.start - viewportStartSec),
                width: sec2px(p.end - p.start) + 4,
                background: `alpha(from ${
                  p.speaker !== null ? speakerColors[p.speaker] : '#CCC'
                } / 30%)`,
                borderColor: `alpha(from ${
                  p.speaker !== null ? speakerColors[p.speaker] : '#CCC'
                } / 70%)`,
              }}
              className={clsx(
                'min-h-8 absolute text-xs cursor-move select-none border-2 rounded',
                dragging && 'z-10',
              )}
              onMouseDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                setDragHandle({
                  type: 'paragraph',
                  startX: e.clientX,
                  paragraph: p,
                });
              }}
            >
              {/* {p.children.map((c, i) => {
                return (
                  <span
                    key={i}
                    style={{
                      left: secsToPixels((c.start || 0) - p.start),
                      width: secsToPixels(c.end - c.start),
                    }}
                    className="absolute border rounded border-white/40 bg-white/15 px-0.5 top-1 overflow-hidden whitespace-nowrap"
                  >
                    {c.text}
                  </span>
                );
              })} */}
              <div className="px-1">{p.children.map((t) => t.text).join('')}</div>
              <ResizeHandle
                type="paragraphStart"
                paragraph={p}
                dragHandle={dragHandle}
                onDragHandleChange={setDragHandle}
              />
              <ResizeHandle
                type="paragraphEnd"
                paragraph={p}
                dragHandle={dragHandle}
                onDragHandleChange={setDragHandle}
              />
            </div>
          );
        })}
      </div>
      <WaveformViewer
        source={waveformSource}
        pos={sec2px(viewportStartSec)}
        scale={px2sec(samplesPerSecond)}
      />
    </div>
  );
}

function ResizeHandle({
  type: side,
  dragHandle,
  onDragHandleChange,
  paragraph,
}: {
  type: 'paragraphStart' | 'paragraphEnd';
  dragHandle: DragHandle | null;
  onDragHandleChange: (d: DragHandle) => void;
  paragraph: ParagraphWithInfos;
}) {
  const active = dragHandle?.paragraph.idx == paragraph.idx && dragHandle?.type == side;
  const speakerColors = useContext(SpeakerColorsContext);

  return (
    <div
      className={clsx(
        side == 'paragraphEnd' ? '-right-[2px]' : '-left-[2px]',
        'w-2 -top-[2px] -bottom-[2px] absolute',
        'hover:opacity-100',
        active ? 'opacity-100' : 'opacity-0',
        'cursor-col-resize rounded-lg',
      )}
      style={{
        backgroundColor: paragraph.speaker !== null ? speakerColors[paragraph.speaker] : '#888888',
      }}
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onDragHandleChange({
          type: side,
          startX: e.clientX,
          paragraph: paragraph,
        });
      }}
    />
  );
}

function WaveformViewer({
  source,
  pos,
  scale,
  onClick,
}: {
  source: MediaFile | null;
  pos: number;
  scale: number;
  onClick?: MouseEventHandler;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [reader, setReader] = useState<WaveformReader | null>(null);
  const systemPrefersDark = useMediaQuery('(prefers-color-scheme: dark)');

  useEffect(() => {
    if (!source) return;

    const getData = async (media: MediaFile) => {
      const res = await fetch(media.url);
      const buffer = await res.arrayBuffer();
      return new WaveformReader(buffer);
    };

    getData(source).then((reader) => {
      setReader(reader);
    });
  }, [source]);

  const renderer = useMemo(() => {
    if (!canvasRef.current) return;

    const ctx = canvasRef.current.getContext('webgl2');
    if (!ctx) {
      console.error('Could not create webGL context.');
      return;
    }

    return new WaveformRenderer(ctx);
  }, [canvasRef.current]);

  useResizeObserver(
    canvasRef.current,
    (rect) => {
      if (!canvasRef.current) return;
      canvasRef.current.width = rect.width * window.devicePixelRatio;
      canvasRef.current.height = rect.height * window.devicePixelRatio;
      if (renderer) renderer.draw();
    },
    [canvasRef.current, renderer, window.devicePixelRatio],
  );

  useEffect(() => {
    if (!renderer || !reader) return;
    renderer.setData(reader.getDataIter());
  }, [renderer, reader]);

  useEffect(() => {
    if (!renderer) return;
    renderer.setColor(systemPrefersDark ? [1, 1, 1] : [0.2, 0.2, 0.2]);
    renderer.setPos(pos * window.devicePixelRatio);
    renderer.setScale(scale / window.devicePixelRatio);
    renderer.draw();
  }, [reader, renderer, pos, scale, window.devicePixelRatio]);

  return <canvas ref={canvasRef} className="w-full h-14" onClick={onClick} />;
}
