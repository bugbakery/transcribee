import { Editor, Transforms } from 'slate';
import { Slate, Editable, RenderElementProps, RenderLeafProps } from 'slate-react';
import { SpeakerDropdown } from './speaker_dropdown';
import { useEvent } from '../utils/use_event';
import { Paragraph, TextClickEvent } from './types';
import { startTimeToClassName } from './player';
import clsx from 'clsx';
import { useContext } from 'react';
import { SpeakerColorsContext } from './speaker_colors';
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
      <>
        <div className="mb-6 flex">
          <div
            contentEditable={false}
            className="w-16 mr-2 -ml-20 hidden 2xl:block text-slate-500 dark:text-neutral-400 font-mono"
            onClick={() => window.dispatchEvent(new TextClickEvent(startAtom))}
          >
            {formattedTime(startAtom.start)}
          </div>

          <div contentEditable={false} className="w-60 mr-2 relative">
            <SpeakerDropdown paragraph={element} />
            <div
              className="mr-2 ml-7 2xl:hidden text-slate-500 dark:text-neutral-400 font-mono"
              onClick={() => window.dispatchEvent(new TextClickEvent(startAtom))}
            >
              {formattedTime(startAtom.start)}
            </div>
            <div
              className="absolute right-0 top-0 w-2 h-full rounded-md mr-1 -mt-0.5"
              style={element.speaker ? { backgroundColor: speakerColors[element.speaker] } : {}}
            />
          </div>

          <div {...attributes} className="grow-1 basis-full" lang={element.lang} spellCheck={false}>
            {children}
          </div>
        </div>
      </>
    );
  }

  throw Error('Unknown element type');
}

function renderLeaf({ leaf, children, attributes }: RenderLeafProps): JSX.Element {
  const parent: Paragraph = children.props.parent;
  const myIndex = parent.children.findIndex((x) => x.start == leaf.start);
  let wordStartIndex = myIndex;
  for (
    ;
    wordStartIndex > 0 && !parent.children[wordStartIndex].text.startsWith(' ');
    wordStartIndex--
  );
  const wordStart = parent.children[wordStartIndex];

  const classes = ['word'];
  if (wordStart?.start !== undefined) {
    classes.push(startTimeToClassName(wordStart.start));
  }

  const systemPrefersDark = useMediaQuery('(prefers-color-scheme: dark)');

  const color = !leaf.conf
    ? undefined
    : systemPrefersDark
    ? `hsl(0, 100%, ${Math.min(leaf.conf * 50 + 50, 100)}%)`
    : `hsl(0, 100%, ${Math.min((1 - leaf.conf) * 100, 45)}%)`;

  return (
    <span
      {...attributes}
      className={classes.join(' ')}
      onClick={() => {
        // this event is handeled in player.tsx to set the time when someone clicks a word
        window.dispatchEvent(new TextClickEvent(leaf));
      }}
      style={{ color }}
    >
      {children}
    </span>
  );
}

export function TranscriptionEditor({
  editor,
  ...props
}: {
  editor: Editor;
} & React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement>) {
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
            (op) => op.type == 'insert_text' || op.type == 'remove_text',
          );
          if (hasChanged) {
            Transforms.setNodes(editor, { conf: 1.0 }, { match: (n) => 'conf' in n });
          }
        }}
      >
        <Editable
          renderElement={(props) => renderElement(props)}
          renderLeaf={renderLeaf}
          onClick={() => {
            const selection = document.getSelection();
            if (
              selection?.isCollapsed &&
              selection.anchorNode?.parentElement?.parentElement?.classList.contains('word')
            ) {
              selection.anchorNode.parentElement.click();
            }
          }}
        />
      </Slate>
    </div>
  );
}
