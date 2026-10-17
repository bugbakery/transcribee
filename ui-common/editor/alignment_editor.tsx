import { clsx } from 'clsx';
import { useState, useRef, useCallback, useEffect, useContext, useMemo } from 'react';
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
}: {
  waveformSource: MediaFile | null;
  editor: Editor;
  time: number;
}) {
  const [pos, setPos] = useState<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const samplesPerPixel = 125;
  const speakerColors = useContext(SpeakerColorsContext);
  const [dragHandle, setDragHandle] = useState<DragHandle | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>();
  const containerSize = useSize(containerRef.current);

  const pixelsToSecs = useCallback(
    (pixels: number) => {
      return pixels / samplesPerPixel;
    },
    [samplesPerPixel],
  );

  const secsToPixels = useCallback(
    (pixels: number) => {
      return pixels * samplesPerPixel;
    },
    [samplesPerPixel],
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
      p.start < pixelsToSecs(pos + (containerSize?.width || 0) + VISIBILITY_MARGIN) &&
      p.end > pixelsToSecs(pos) - VISIBILITY_MARGIN
    );
  });

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
      setPos((x) => x + e.deltaX * deltaMultiplier);
    };

    c.addEventListener('wheel', listener, { passive: false });

    return () => {
      c.removeEventListener('wheel', listener);
    };
  }, [containerRef.current]);

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
        const relativeSecs = pixelsToSecs(mousePos.x - dragHandle.startX);
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
  }, [dragHandle, mousePos, editor]);

  return (
    <div ref={containerRef}>
      <div className="h-[85px] relative overflow-hidden -mb-14">
        <div
          className="absolute w-[2px] bottom-0 top-[25px] bg-red-500"
          style={{ left: secsToPixels(time) - pos }}
        />
        {visibleParagraphs.map((p) => {
          let dragging = false;

          // handle temporary adjustments while dragging
          if (dragHandle && mousePos && dragHandle.paragraph.idx == p.idx) {
            dragging = true;
            switch (dragHandle.type) {
              case 'paragraphStart':
                p = {
                  ...p,
                  start: p.start + pixelsToSecs(mousePos.x - dragHandle.startX),
                };
                break;
              case 'paragraphEnd':
                p = {
                  ...p,
                  end: p.end + pixelsToSecs(mousePos.x - dragHandle.startX),
                };
                break;
              case 'paragraph':
                p = {
                  ...p,
                  start: p.start + pixelsToSecs(mousePos.x - dragHandle.startX),
                  end: p.end + pixelsToSecs(mousePos.x - dragHandle.startX),
                };
                break;
            }
          }

          return (
            <div
              key={p.idx}
              style={{
                left: secsToPixels(p.start) - pos,
                width: secsToPixels(p.end - p.start),
                background: `alpha(from ${
                  p.speaker !== null ? speakerColors[p.speaker] : '#CCC'
                } / 30%)`,
                borderColor: `alpha(from ${
                  p.speaker !== null ? speakerColors[p.speaker] : '#CCC'
                } / 70%)`,
                borderWidth: 2,
                borderRadius: 4,
              }}
              className={clsx(
                'min-h-5 absolute text-xs cursor-move select-none',
                dragging && 'z-10',
              )}
              onMouseDown={(e) => {
                setDragHandle({
                  type: 'paragraph',
                  startX: e.clientX,
                  paragraph: p,
                });
              }}
            >
              <div className="relative">
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
            </div>
          );
        })}
      </div>
      <WaveformViewer source={waveformSource} pos={pos} />
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

function WaveformViewer({ source, pos }: { source: MediaFile | null; pos: number }) {
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
    renderer.setScale(1.0 / window.devicePixelRatio);
    renderer.draw();
  }, [reader, renderer, pos, window.devicePixelRatio]);

  return <canvas ref={canvasRef} className="w-full h-14" />;
}
