import { Editor, Transforms, Range, Operation } from 'slate';
import {
  Slate,
  Editable,
  RenderElementProps,
  RenderLeafProps,
  ReactEditor,
  useSlateSelector,
  useReadOnly,
} from 'slate-react';
import { SpeakerDropdown } from './speaker_dropdown';
import { useEvent } from '../utils/use_event';
import { SeekToEvent, Paragraph } from './types';
import { PlayerBar, startTimeToClassName } from './player';
import clsx from 'clsx';
import React, { ComponentProps, useContext, useCallback, memo, useState } from 'react';
import { SpeakerColorsContext, SpeakerColorsProvider } from './speaker_colors';
import { useMediaQuery } from '../utils/use_media_query';
import { useSpeakerName } from '../utils/document';
import { LoadingBee } from '../components/loading_spinner/loading_bee';

import { useInView } from 'react-intersection-observer';
import { ErrorBoundary } from './editor_error_boundary';

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

export const LoadingContext = React.createContext<[boolean, (next: boolean) => void]>([
  false,
  (_x) => {
    /* this is just a placeholder */
  },
]);

function Paragraph({ element, children, attributes }: RenderElementProps): JSX.Element {
  const readOnly = useReadOnly();
  const startAtom = element.children[0];
  const speakerColors = useContext(SpeakerColorsContext);
  const [loading, setLoading] = useContext(LoadingContext);

  if (loading) {
    setTimeout(() => {
      setLoading(false);
    }, 0);
  }

  // This is a rather bad hack but saves A LOT of resources.
  const { ref, inView } = useInView({
    fallbackInView: true,
    initialInView: !loading,
  });

  const speakerChanged = useSlateSelector((editor) => {
    const idx = ReactEditor.findPath(editor, element)[0];
    return idx == 0 || editor.doc.children[idx - 1].speaker != element.speaker;
  });

  const speakerName = useSpeakerName(element.speaker);

  const metaInformation = (
    <div
      className="md:w-[200px] lg:w-[280px] grid shrink-0 grid-cols-[auto_1fr_auto] select-none"
      contentEditable={false}
    >
      {/* start time */}
      <div
        className={clsx(`text-slate-500 dark:text-neutral-400 tabular-nums`, 'md:mr-4')}
        onClick={() => window.dispatchEvent(new SeekToEvent(startAtom.start))}
      >
        {formattedTime(startAtom.start)}
      </div>

      {/* speaker names */}
      {speakerChanged && (
        <div className="hidden md:block overflow-clip row-start-1 col-start-2">
          <div
            className={clsx(
              '-mt-[0.1rem] py-1',
              'max-w-none text-neutral-500',
              'text-sm font-semibold',
              'md:max-w-[200px] md:text-neutral-600 md:dark:text-neutral-200',
              'bg-white dark:bg-neutral-900',
              'md:text-right md:pr-3',
            )}
          >
            {speakerName}
          </div>
        </div>
      )}

      <div
        className={clsx(
          'mx-2 -mt-0.5 md:mt-0 md:-ml-2',
          'row-start-1 col-start-2', // render on top of speaker name
          'md:max-h-7', // prevent extensive whitespace on paragraph when dropdown is only shown on hover
        )}
      >
        {!readOnly && (
          <SpeakerDropdown
            paragraph={element}
            buttonClassName={clsx(
              'text-neutral-500 md:text-neutral-600 md:dark:text-neutral-200',
              'md:text-right',
              'md:opacity-0 md:hover:opacity-100',
              'md:pr-2',
            )}
            dropdownContainerClassName="pb-24"
          />
        )}
      </div>

      {/* speaker color indicator */}
      <div className={clsx('relative w-2 h-full', 'mr-2 md:mr-4', 'hidden md:block')}>
        <div
          style={{
            ...(element.speaker ? { backgroundColor: speakerColors[element.speaker] } : {}),
          }}
          className={clsx(
            'absolute bottom-0 w-full',
            speakerChanged ? 'top-0' : '-top-6',
            'rounded-md',
          )}
        />
      </div>
    </div>
  );

  return (
    <div
      className="flex flex-col md:flex-row mb-4 pl-6 md:pl-0 relative"
      ref={ref}
      contentEditable={inView ? undefined : false} // Prevent users from changing the text while the leafs are not rendered
    >
      {/* speaker color indicator for large screens */}

      <div
        contentEditable={false}
        style={{
          ...(element.speaker ? { backgroundColor: speakerColors[element.speaker] } : {}),
        }}
        className={clsx(
          'absolute left-0 bottom-0 w-2',
          speakerChanged ? 'top-0' : '-top-6',
          'rounded-md',
          'md:hidden',
          'select-none',
        )}
      />

      {metaInformation}

      <div {...attributes} lang={element.lang} spellCheck={false}>
        {/* If the paragraph is out of view, we do not render the children (which would the the text
          leafs). Instead we just add the plain text of the paragraph here to enable search and
          scrolling without jumping content. */}
        {inView ? children : element.children.map((x) => x.text).join('')}
      </div>
    </div>
  );
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
  documentId,
  readOnly,
  initialValue,
  onShowVideo,
  ...props
}: {
  editor?: Editor;
  documentId: string;
  readOnly: boolean;
  initialValue?: Paragraph[];
  onShowVideo?: (show: boolean) => void;
} & ComponentProps<'div'>) {
  const systemPrefersDark = useMediaQuery('(prefers-color-scheme: dark)');
  // prevent ctrl+s
  useEvent('keydown', (e: KeyboardEvent) => {
    const ctrlOrCmd = window.navigator.platform.match('Mac') ? e.metaKey : e.ctrlKey;
    if (ctrlOrCmd && e.key === 's') {
      e.preventDefault();
      console.log('CommandOrControl + S prevented – we automatically save the document anyways');
    }
  });

  const loadingState = useState(true);

  const renderLeaf = useCallback(
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
  );

  return (
    <div {...props}>
      {loadingState[0] && (
        <>
          <div
            className={clsx(
              'grow-[2] fixed left-0 top-0 flex items-center justify-center w-full h-full bg-white dark:bg-neutral-900 z-30',
            )}
          >
            <LoadingBee size={200} />
          </div>
        </>
      )}
      {editor && initialValue && (
        <Slate
          editor={editor}
          value={initialValue}
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
            <LoadingContext.Provider value={loadingState}>
              <ErrorBoundary editor={editor}>
                <Editable
                  renderElement={Paragraph}
                  renderLeaf={renderLeaf}
                  readOnly={readOnly}
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
                  className={clsx('2xl:-ml-20')}
                />
              </ErrorBoundary>
              {!loadingState[0] && (
                <PlayerBar documentId={documentId} editor={editor} onShowVideo={onShowVideo} />
              )}
            </LoadingContext.Provider>
          </SpeakerColorsProvider>
        </Slate>
      )}
    </div>
  );
}
