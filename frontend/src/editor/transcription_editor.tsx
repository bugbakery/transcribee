import { Editor, Transforms, Range, Operation } from 'slate';
import { Slate, Editable, RenderElementProps, RenderLeafProps } from 'slate-react';
import { SpeakerDropdown } from './speaker_dropdown';
import { useEvent } from '../utils/use_event';
import { SeekToEvent } from './types';
import { startTimeToClassName } from './player';
import clsx from 'clsx';
import { useContext, useCallback, memo } from 'react';
import { SpeakerColorsContext, SpeakerColorsProvider } from './speaker_colors';
import { useMediaQuery } from '../utils/use_media_query';

export function formattedTime(sec: number | undefined): string {
  if (sec === undefined) {
    return 'unknown';
  }

  const seconds = Math.floor(sec % 60)
    .toString()
    .padStart(2, '0');
  const minutes = Math.floor((sec / 60) % 60)
    .toString()
    .padStart(2, '0');
  const hours = Math.floor(sec / 60 / 60)
    .toString()
    .padStart(2, '0');
  if (Math.floor(sec / 60 / 60) > 0) {
    return `${hours}:${minutes}:${seconds}`;
  }
  return `${minutes}:${seconds}`;
}

function renderElement({ element, children, attributes }: RenderElementProps): JSX.Element {
  const startAtom = element.children[0];
  const speakerColors = useContext(SpeakerColorsContext);

  if (element.type === 'paragraph') {
    return (
      <div className="contents order-0">
        <div
          contentEditable={false}
          className={clsx(
            'w-2 mr-2 h-full rounded-md row-span-2',
            'md:ml-1 md:col-start-2',
            'xl:row-span-1 xl:col-start-3',
          )}
          style={element.speaker ? { backgroundColor: speakerColors[element.speaker] } : {}}
        />

        <div
          contentEditable={false}
          className="text-slate-500 dark:text-neutral-400 font-mono md:col-start-1"
          onClick={() => window.dispatchEvent(new SeekToEvent(startAtom.start))}
        >
          {formattedTime(startAtom.start)}
        </div>

        <div
          {...attributes}
          className={clsx(
            'grow-1 basis-full col-span-2',
            'md:col-span-1 md:row-span-2 md:col-start-3',
            'xl:row-span-1 xl:col-start-4',
          )}
          lang={element.lang}
          spellCheck={false}
        >
          {children}
        </div>

        <SpeakerDropdown
          contentEditable={false}
          paragraph={element}
          buttonClassName={clsx(
            'max-w-none break-all text-neutral-400 relative top-0.5',
            'md:max-w-[200px] md:text-neutral-600 md:col-start-1',
            'xl:col-start-2',
          )}
          className="md:-ml-2.5 xl:ml-0"
        />

        <div className="mb-3 col-span-3 xl:col-span-4" />
      </div>
    );
  }

  throw Error('Unknown element type');
}

const Leaf = memo(
  ({
    start,
    conf,
    children,
    attributes,
    systemPrefersDark,
  }: {
    start?: number;
    conf?: number;
    children: RenderLeafProps['children'];
    attributes: RenderLeafProps['attributes'];
    systemPrefersDark: boolean;
  }): JSX.Element => {
    const color = !conf
      ? undefined
      : systemPrefersDark
      ? `hsl(0, 100%, ${Math.min(conf * 50 + 50, 100)}%)`
      : `hsl(0, 100%, ${Math.min((1 - conf) * 100, 45)}%)`;

    const classes = ['word'];
    if (start !== undefined) {
      classes.push(startTimeToClassName(start));
    }

    return (
      <span
        {...attributes}
        className={classes.join(' ')}
        onClick={() => {
          // this event is handeled in player.tsx to set the time when someone clicks a word
          window.dispatchEvent(new SeekToEvent(start));
        }}
        style={{ color }}
      >
        {children}
      </span>
    );
  },
);

Leaf.displayName = 'Leaf';

export function TranscriptionEditor({
  editor,
  ...props
}: {
  editor: Editor;
} & React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement>) {
  const systemPrefersDark = useMediaQuery('(prefers-color-scheme: dark)');
  // prevent ctrl+s
  useEvent('keydown', (e: KeyboardEvent) => {
    const ctrlOrCmd = window.navigator.platform.match('Mac') ? e.metaKey : e.ctrlKey;
    if (ctrlOrCmd && e.key === 's') {
      e.preventDefault();
      console.log('CommandOrControl + S prevented – we automatically save the document anyways');
    }
  });

  return (
    <div {...props} className={clsx('pb-40', props.className)}>
      <Slate
        editor={editor}
        value={
          [
            /* the value is actually managed by the editor object */
          ]
        }
        onChange={() => {
          // set the confidence of manually edited nodes to 1.0
          const hasChanged = editor.operations.some(
            (op: Operation) => op.type == 'insert_text' || op.type == 'remove_text',
          );
          if (hasChanged) {
            Transforms.setNodes(editor, { conf: 1.0 }, { match: (n) => 'conf' in n });
          }
        }}
      >
        <SpeakerColorsProvider>
          <Editable
            renderElement={renderElement}
            renderLeaf={useCallback(
              (props: RenderLeafProps) => {
                const { leaf, children, attributes } = props;
                return (
                  <Leaf
                    attributes={attributes}
                    conf={leaf.conf}
                    start={leaf.start}
                    systemPrefersDark={systemPrefersDark}
                  >
                    {children}
                  </Leaf>
                );
              },
              [systemPrefersDark],
            )}
            onClick={(e: React.MouseEvent) => {
              const { selection } = editor;

              // fire a 'seek to' event when selection is changed by clicking outside of a text node
              // e.g. by clicking at the blank space on the right of a paragraph
              if (
                selection &&
                Range.isCollapsed(selection) &&
                e.target instanceof HTMLElement &&
                e.target.isContentEditable
              ) {
                const [leaf] = editor.leaf(selection.anchor);
                window.dispatchEvent(new SeekToEvent(leaf.start));
              }
            }}
            className={clsx(
              'grid grid-flow-row-dense items-start grid-cols-[max-content_min-content_1fr]',
              'md:auto-rows-[24px_auto_auto]',
              'xl:auto-rows-auto xl:grid-cols-[min-content_max-content_min-content_1fr]',
              '2xl:-ml-20',
            )}
          />
        </SpeakerColorsProvider>
      </Slate>
    </div>
  );
}
