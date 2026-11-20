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
import { produce } from 'immer';
import { useDocumentSelector } from '../utils/document';
import { MediaFile } from './api_document';
import { SpeakerColorsContext } from './speaker_colors';
import { WaveformRenderer } from './waveform_renderer';
import { WaveformReader } from './waveform_reader';
import { useMediaQuery } from '../utils/use_media_query';
import { useResizeObserver } from '../utils/use_resize_observer';
import { Paragraph, Text, TextWithTs } from './types';
import { useSize } from '../utils/use_size';
import { clamp } from '../utils/math';
import { useSmoothMediaPlayerPlaytime } from '../utils/use_media_player';
import { MediaPlayer } from '../utils/media_player';
import { IconButton } from '../components/button';
import { LuWholeWord } from 'react-icons/lu';

type DragHandle =
  | {
      type: 'paragraph' | 'paragraphStart' | 'paragraphEnd';
      startX: number;
      paragraph: ParagraphWithInfos;
    }
  | {
      type: 'atom' | 'atomStart' | 'atomEnd';
      atomIdx: number;
      startX: number;
      paragraph: ParagraphWithInfos;
    };

type ParagraphWithInfos = Paragraph & {
  idx: number;
  start: number;
  end: number;
  stackIdx: number;
};

const MIN_ATOM_LENGTH = 0.05;

function atomLen(atom: TextWithTs) {
  return atom.end - atom.start;
}

function adjustParagraphTs(
  p: ParagraphWithInfos,
  { start, end }: { start?: number; end?: number },
): ParagraphWithInfos {
  const newStart = start ?? p.start;
  const newEnd = end ?? p.end;
  const newLength = newEnd - newStart;
  const scaleRatio = newLength / (p.end - p.start);

  return produce(p, (p) => {
    p.children.forEach((child) => {
      if (child.start != null) {
        child.start = newStart + (child.start - p.start) * scaleRatio;
      }
      if (child.end != null) {
        child.end = newStart + (child.end - p.start) * scaleRatio;
      }

      if (child.start != null && atomLen(child) < MIN_ATOM_LENGTH) {
        if (end !== undefined) {
          child.end = child.start + MIN_ATOM_LENGTH;
        } else {
          child.start = child.end - MIN_ATOM_LENGTH;
        }
      }

      console.assert(child.start == null || child.end == null || child.start <= child.end);
    });

    if (end != undefined) {
      for (let i = 1; i < p.children.length; i++) {
        const c = p.children[i];
        const prev = p.children[i - 1];
        if (c.start != null && prev.end != null && c.start < prev.end) {
          c.start = prev.end;

          if (atomLen(c) < MIN_ATOM_LENGTH) {
            c.end = c.start + MIN_ATOM_LENGTH;
          }
        }
      }
    }

    if (start != undefined) {
      for (let i = p.children.length - 2; i >= 0; i--) {
        const c = p.children[i];
        const next = p.children[i + 1];
        if (c.end != null && next.start != null && c.end > next.start) {
          c.end = next.start;

          if (atomLen(c) < MIN_ATOM_LENGTH) {
            c.start = c.end - MIN_ATOM_LENGTH;
          }
        }
      }
    }

    p.start = p.children[0]?.start || 0;
    p.end = p.children[p.children.length - 1]?.end || 0;
  });
}

function adjustParagraphAtomTs(
  p: ParagraphWithInfos,
  atomIdx: number,
  { start, end }: { start?: number; end?: number },
) {
  return produce(p, (p) => {
    const atom = p.children[atomIdx];

    if (start != undefined) {
      atom.start = start;
    }
    if (end != undefined) {
      atom.end = end;
    }
    console.assert(atom.start == null || atom.end == null || atom.start <= atom.end);

    // enforce minumum atom length
    if (atom.start != null && atomLen(atom) < MIN_ATOM_LENGTH) {
      if (end) {
        atom.end = atom.start + MIN_ATOM_LENGTH;
      }
      if (start) {
        atom.start = atom.end - MIN_ATOM_LENGTH;
      }
    }

    // nudge atoms after the adjusted one
    if (end != undefined) {
      for (let i = atomIdx + 1; i < p.children.length; i++) {
        const c = p.children[i];
        const prev = p.children[i - 1];
        if (c.start != null && prev.end != null && c.start < prev.end) {
          c.start = prev.end;

          if (atomLen(c) < MIN_ATOM_LENGTH) {
            c.end = c.start + MIN_ATOM_LENGTH;
          }
        }
      }
    }

    // nudge atoms before the adjusted one
    if (start != undefined) {
      for (let i = atomIdx - 1; i >= 0; i--) {
        const c = p.children[i];
        const next = p.children[i + 1];
        if (c.end != null && next.start != null && c.end > next.start) {
          c.end = next.start;

          if (atomLen(c) < MIN_ATOM_LENGTH) {
            c.start = c.end - MIN_ATOM_LENGTH;
          }
        }
      }
    }

    p.start = p.children[0]?.start || 0;
    p.end = p.children[p.children.length - 1]?.end || 0;
  });
}

function updateParagraphChildrenTs(editor: Editor, p: ParagraphWithInfos) {
  Editor.withoutNormalizing(editor, () => {
    p.children.forEach((child, i) => {
      if (child.start != undefined && child.end != undefined) {
        const update: Partial<Text> = {
          conf_ts: 1.0, // manually set timestamps get maximum confidence
          start: child.start,
          end: child.end,
        };
        Transforms.setNodes(editor, update, { at: [p.idx, i] });
      }
    });
  });
}

export function AlignmentEditor({
  waveformSource,
  editor,
  mediaPlayer,
}: {
  waveformSource: MediaFile | null;
  editor: Editor;
  mediaPlayer: MediaPlayer;
}) {
  const samplesPerSecond = 16_000 / 128;
  const [pxPerSec, setPxPerSec] = useState(100.0);

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

  const VISIBILITY_MARGIN = 200;
  const [viewportStartSec, setViewportStartSec] = useState<number>(
    mediaPlayer.playtime - px2sec(VISIBILITY_MARGIN),
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const speakerColors = useContext(SpeakerColorsContext);
  const [dragHandle, setDragHandle] = useState<DragHandle | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>();
  const containerSize = useSize(containerRef.current);
  const [editAtoms, setEditAtoms] = useState(false);

  const paragraphs: ParagraphWithInfos[] = useDocumentSelector(
    (doc) => {
      return (
        doc.children?.map((p, i) => ({
          ...p,
          idx: i,
          start: p.children[0]?.start || 0,
          end: p.children[p.children.length - 1]?.end || 0,
          stackIdx: 0,
        })) || []
      );
    },
    {
      eq: (a, b) => JSON.stringify(a) == JSON.stringify(b),
      editor,
    },
  );

  // calculate stacking
  const stacked = useMemo(() => {
    const stack: number[] = [];
    // this depends on paragraphs being sorted by time
    return paragraphs
      .toSorted((a, b) => a.start - b.start)
      .map((p) => {
        let stackIdx = 0;
        for (const end of stack) {
          if (end <= p.start) {
            break;
          }
          stackIdx++;
        }

        stack[stackIdx] = p.end;

        return {
          ...p,
          stackIdx: stackIdx,
        };
      });
  }, [paragraphs]);

  const visibleParagraphs = stacked.filter((p) => {
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
  const animatedSetViewportStartSec = useCallback(
    (targetPos: number) => {
      if (seekTarget.current != null) return;
      const startTime = Date.now();
      const targetTime = startTime + 300;
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
    },
    [viewportStartSec],
  );

  const isDecoupledRef = useRef(false);

  useEffect(() => {
    const onPlay = () => {
      // re-couple on play
      isDecoupledRef.current = false;
    };

    const onSeek = (to: number) => {
      if (!containerSize) return;

      // scroll to play position if not in view
      const viewportEndSec = viewportStartSec + px2sec(containerSize.width);
      const marginSec = px2sec(containerSize.width) * 0.07;
      if (to > viewportEndSec || to < viewportStartSec) {
        animatedSetViewportStartSec(to - marginSec);
      }

      // re-couple on seeks
      isDecoupledRef.current = false;
    };

    const onPlaytimeUpdate = (playtime: number) => {
      if (!containerSize) return;

      const viewportEndSec = viewportStartSec + px2sec(containerSize.width);
      const marginSec = px2sec(containerSize.width) * 0.07;
      // keep the cursor in viewport (generally)
      // the view gets decoupled when one pans manually and it gets coupled again when
      // * the user seeks to a different position manually
      // * the user starts playing
      if (isDecoupledRef.current || seekTarget.current != null || mediaPlayer.isScrubbing) return;
      if (playtime > viewportEndSec - marginSec) {
        if (dragHandle != null) {
          // do not move viewport while dragging
          return;
        }
        setViewportStartSec(playtime - marginSec);
      } else if (playtime < viewportStartSec) {
        setViewportStartSec(playtime - marginSec);
      }
    };

    mediaPlayer.addListener('play', onPlay);
    mediaPlayer.addListener('seek', onSeek);
    mediaPlayer.addListener('playtime', onPlaytimeUpdate);

    return () => {
      mediaPlayer.removeListener('play', onPlay);
      mediaPlayer.removeListener('seek', onSeek);
      mediaPlayer.removeListener('playtime', onPlaytimeUpdate);
    };
  }, [
    mediaPlayer,
    viewportStartSec,
    animatedSetViewportStartSec,
    containerSize,
    dragHandle,
    px2sec,
  ]);

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

      let zoom = 0;
      let scroll = 0;

      if (e.ctrlKey || e.metaKey) {
        // pinching on a trackpad is also reported as ctrl key + y scroll
        zoom = e.deltaY * deltaMultiplier;
      } else {
        // Sadly we cannot detect if a wheel event comes from a devices that supports horizontal scrolling (like a trackpad).
        // The next best thing is to use the horizontal motion if it is not 0, otherwise use the vertical motion.
        if (e.deltaX) {
          scroll = e.deltaX * deltaMultiplier;
        } else {
          scroll = e.deltaY * deltaMultiplier;
        }
      }

      const canvasBoundingRect = c.getBoundingClientRect();
      if (zoom) {
        const newPxPerSec = clamp(pxPerSec - sec2px(zoom * 0.01), 20, 600);

        const oldMouseX = (e.clientX - canvasBoundingRect.x) / pxPerSec;
        const newMouseX = (e.clientX - canvasBoundingRect.x) / newPxPerSec;
        setViewportStartSec((x) => x + oldMouseX - newMouseX);
        setPxPerSec(newPxPerSec);
      } else {
        setViewportStartSec((x) => x + px2sec(scroll));
        isDecoupledRef.current = true;
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

        if (dragHandle.type == 'paragraph') {
          const newP = adjustParagraphTs(p, {
            start: p.start + relativeSecs,
            end: p.end + relativeSecs,
          });
          updateParagraphChildrenTs(editor, newP);
        } else if (dragHandle.type == 'paragraphStart') {
          const newP = adjustParagraphTs(p, {
            start: p.start + relativeSecs,
          });
          updateParagraphChildrenTs(editor, newP);
        } else if (dragHandle.type == 'paragraphEnd') {
          const newP = adjustParagraphTs(p, { end: p.end + relativeSecs });
          updateParagraphChildrenTs(editor, newP);
        } else if (dragHandle.type == 'atom') {
          const newP = adjustParagraphAtomTs(p, dragHandle.atomIdx, {
            start: p.children[dragHandle.atomIdx].start! + relativeSecs,
            end: p.children[dragHandle.atomIdx].end! + relativeSecs,
          });
          updateParagraphChildrenTs(editor, newP);
        } else if (dragHandle.type == 'atomStart') {
          const newP = adjustParagraphAtomTs(p, dragHandle.atomIdx, {
            start: p.children[dragHandle.atomIdx].start! + relativeSecs,
          });
          updateParagraphChildrenTs(editor, newP);
        } else if (dragHandle.type == 'atomEnd') {
          const newP = adjustParagraphAtomTs(p, dragHandle.atomIdx, {
            end: p.children[dragHandle.atomIdx].end! + relativeSecs,
          });
          updateParagraphChildrenTs(editor, newP);
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

  const startScrub = useCallback(
    (e: React.MouseEvent) => {
      const target = e.currentTarget;

      const onMouse = (e: React.MouseEvent | MouseEvent) => {
        if (dragHandle) return;

        if (e.buttons & 1) {
          const clickTime = px2sec(e.clientX - target.getBoundingClientRect().x) + viewportStartSec;
          mediaPlayer.startScrub(clickTime);
        }
      };

      onMouse(e);

      const onMouseUp = () => {
        mediaPlayer.endScrub();
        document.removeEventListener('mouseup', onMouseUp);
        document.removeEventListener('mousemove', onMouse);
      };

      // handled globally, so we never miss when the scrubbing ends
      document.addEventListener('mousemove', onMouse);
      document.addEventListener('mouseup', onMouseUp);
    },
    [dragHandle, viewportStartSec, px2sec, mediaPlayer],
  );

  return (
    <div>
      <div ref={containerRef}>
        <div className="h-[85px] relative overflow-hidden -mb-14" onMouseDown={startScrub}>
          <TimeIndicator
            mediaPlayer={mediaPlayer}
            viewportStartSec={viewportStartSec}
            sec2px={sec2px}
          />
          <IconButton
            icon={LuWholeWord}
            onClick={() => {
              setEditAtoms(!editAtoms);
            }}
            onMouseDown={(e) => {
              e.stopPropagation();
            }}
            label={editAtoms ? 'show word level alignment' : 'hide word level alignment'}
            className="absolute right-0 bottom-0 bg-white dark:bg-black border-2 border-black dark:border-white p-1 rounded"
          />
          {visibleParagraphs.map((p) => {
            // handle temporary adjustments while dragging
            if (dragHandle && mousePos && dragHandle.paragraph.idx == p.idx) {
              const offset = px2sec(mousePos.x - dragHandle.startX);

              switch (dragHandle.type) {
                case 'paragraphStart':
                  p = adjustParagraphTs(p, {
                    start: p.start + offset,
                  });
                  break;
                case 'paragraphEnd':
                  p = adjustParagraphTs(p, {
                    end: p.end + offset,
                  });
                  break;
                case 'paragraph':
                  p = adjustParagraphTs(p, {
                    start: p.start + offset,
                    end: p.end + offset,
                  });
                  break;
                case 'atom':
                  p = adjustParagraphAtomTs(p, dragHandle.atomIdx, {
                    start: p.children[dragHandle.atomIdx].start! + offset,
                    end: p.children[dragHandle.atomIdx].end! + offset,
                  });
                  break;
                case 'atomStart':
                  p = adjustParagraphAtomTs(p, dragHandle.atomIdx, {
                    start: p.children[dragHandle.atomIdx].start! + offset,
                  });
                  break;
                case 'atomEnd':
                  p = adjustParagraphAtomTs(p, dragHandle.atomIdx, {
                    end: p.children[dragHandle.atomIdx].end! + offset,
                  });
                  break;
              }
            }

            if (editAtoms) {
              return (
                <TimingParagraphAtoms
                  key={p.idx}
                  p={p}
                  viewportStartSec={viewportStartSec}
                  speakerColors={speakerColors}
                  sec2px={sec2px}
                  setDragHandle={setDragHandle}
                  dragHandle={dragHandle}
                />
              );
            } else {
              return (
                <TimingParagraph
                  key={p.idx}
                  p={p}
                  viewportStartSec={viewportStartSec}
                  speakerColors={speakerColors}
                  sec2px={sec2px}
                  setDragHandle={setDragHandle}
                  dragHandle={dragHandle}
                />
              );
            }
          })}
        </div>

        <WaveformViewer
          source={waveformSource}
          pos={sec2px(viewportStartSec)}
          scale={px2sec(samplesPerSecond)}
        />
      </div>
    </div>
  );
}

function TimeIndicator({
  mediaPlayer,
  viewportStartSec,
  sec2px,
}: {
  mediaPlayer: MediaPlayer;
  viewportStartSec: number;
  sec2px: (sec: number) => number;
}) {
  const time = useSmoothMediaPlayerPlaytime(mediaPlayer);
  return (
    <div
      className="absolute w-[2px] bottom-0 top-[25px] bg-red-500"
      style={{ left: sec2px(time - viewportStartSec) }}
    />
  );
}

function TimingParagraph({
  p,
  viewportStartSec,
  speakerColors,
  sec2px,
  setDragHandle,
  dragHandle,
}: {
  p: ParagraphWithInfos;
  viewportStartSec: number;
  speakerColors: Record<string, string>;
  sec2px: (sec: number) => number;
  dragHandle: DragHandle | null;
  setDragHandle: (handle: DragHandle) => void;
}) {
  return (
    <div
      style={{
        left: sec2px(p.start - viewportStartSec),
        width: sec2px(p.end - p.start),
        top: `calc(${p.stackIdx}em + ${p.stackIdx * 12}px)`,
        background: `alpha(from ${p.speaker !== null ? speakerColors[p.speaker] : '#CCC'} / 30%)`,
        borderColor: `alpha(from ${p.speaker !== null ? speakerColors[p.speaker] : '#CCC'} / 70%)`,
      }}
      className={clsx(
        'absolute text-xs cursor-move select-none rounded',
        dragHandle?.paragraph.idx == p.idx && 'z-10',
        'min-h-[calc(1em_+_8px)] border-2 truncate',
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
}

function TimingParagraphAtoms({
  p,
  viewportStartSec,
  speakerColors,
  sec2px,
  setDragHandle,
  dragHandle,
}: {
  p: ParagraphWithInfos;
  viewportStartSec: number;
  speakerColors: Record<string, string>;
  sec2px: (sec: number) => number;
  dragHandle: DragHandle | null;
  setDragHandle: (handle: DragHandle) => void;
}) {
  return (
    <div
      key={p.idx}
      style={{
        ...{
          left: sec2px(p.start - viewportStartSec),
          width: sec2px(p.end - p.start),
          top: p.stackIdx * 30,
        },
      }}
      className={clsx('absolute text-xs select-none', dragHandle?.paragraph.idx == p.idx && 'z-10')}
    >
      <div
        style={{
          backgroundColor: `alpha(from ${
            p.speaker !== null ? speakerColors[p.speaker] : '#CCC'
          } / 70%)`,
        }}
        className="relative rounded h-1.5"
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
      {p.children.map((c, i) => {
        if (c.start == null || c.end == null) {
          return null;
        }

        return (
          <span
            key={i}
            style={{
              background: `alpha(from ${
                p.speaker !== null ? speakerColors[p.speaker] : '#CCC'
              } / 30%)`,
              borderColor: `alpha(from ${
                p.speaker !== null ? speakerColors[p.speaker] : '#CCC'
              } / 70%)`,
              left: sec2px(c.start - p.start),
              width: sec2px(c.end - c.start),
            }}
            className="absolute border rounded px-0.5 top-2 min-h-[calc(1em_+_8px)] overflow-hidden whitespace-nowrap"
            onMouseDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              setDragHandle({
                type: 'atom',
                startX: e.clientX,
                paragraph: p,
                atomIdx: i,
              });
            }}
          >
            {c.text}
            <ResizeHandle
              type="atomStart"
              paragraph={p}
              dragHandle={dragHandle}
              onDragHandleChange={setDragHandle}
              atomIdx={i}
            />
            <ResizeHandle
              type="atomEnd"
              paragraph={p}
              dragHandle={dragHandle}
              onDragHandleChange={setDragHandle}
              atomIdx={i}
            />
          </span>
        );
      })}
    </div>
  );
}

function ResizeHandle({
  type,
  dragHandle,
  onDragHandleChange,
  paragraph,
  atomIdx,
}: {
  type: 'paragraphStart' | 'paragraphEnd' | 'atomStart' | 'atomEnd';
  dragHandle: DragHandle | null;
  onDragHandleChange: (d: DragHandle) => void;
  paragraph: ParagraphWithInfos;
  atomIdx?: number;
}) {
  let active = dragHandle?.paragraph.idx == paragraph.idx && dragHandle?.type == type;

  if (dragHandle && active && atomIdx !== undefined) {
    active = 'atomIdx' in dragHandle && dragHandle.atomIdx == atomIdx;
  }

  const speakerColors = useContext(SpeakerColorsContext);

  return (
    <div
      className={clsx(
        type == 'paragraphEnd' || type == 'atomEnd' ? '-right-[2px]' : '-left-[2px]',
        'w-2 -top-[2px] -bottom-[2px] absolute',
        'hover:opacity-100',
        active ? 'opacity-100' : 'opacity-0',
        'cursor-ew-resize rounded-lg',
      )}
      style={{
        backgroundColor: paragraph.speaker !== null ? speakerColors[paragraph.speaker] : '#888888',
      }}
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (type == 'atomStart' || type == 'atomEnd') {
          if (atomIdx == undefined) {
            console.error('atomIdx may not be undefined');
            return;
          }
          onDragHandleChange({
            type,
            startX: e.clientX,
            paragraph: paragraph,
            atomIdx: atomIdx,
          });
        } else {
          onDragHandleChange({
            type,
            startX: e.clientX,
            paragraph: paragraph,
          });
        }
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
