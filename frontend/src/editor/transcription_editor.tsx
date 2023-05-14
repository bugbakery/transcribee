import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { createEditor, Descendant } from 'slate';
import { withReact, Slate, Editable, RenderElementProps, RenderLeafProps } from 'slate-react';
import * as Automerge from '@automerge/automerge';
import { withAutomergeDoc } from 'slate-automerge-doc';
import { AutomergeWebsocketProvider } from './automerge_websocket_provider';
import { useDebugMode } from '../debugMode';

import { TextClickEvent } from './types';
import { SecondaryButton } from '../components/button';
import { PlayerBar, startTimeToClassName } from './player';
import { useLocation } from 'wouter';

import { SpeakerDropdown } from './speaker_dropdown';
import clsx from 'clsx';
import { showModal } from '../components/modal';
import { WebvttExportModal } from './webvtt_export';
import { canGenerateVtt } from '../utils/export/webvtt';

const LazyDebugPanel = lazy(() =>
  import('./debug_panel').then((module) => ({ default: module.DebugPanel })),
);

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

          <div contentEditable={false} className="w-56 mr-2 relative">
            <SpeakerDropdown paragraph={element} />
            <div
              className="mr-2 ml-7 2xl:hidden text-slate-500 dark:text-neutral-400 font-mono"
              onClick={() => window.dispatchEvent(new TextClickEvent(startAtom))}
            >
              {formattedTime(startAtom.start)}
            </div>
          </div>

          <div {...attributes} className="grow-1 basis-full" lang={element.lang}>
            {children}
          </div>
        </div>
      </>
    );
  }

  throw Error('Unknown element type');
}

function renderLeaf({ leaf, children, attributes }: RenderLeafProps): JSX.Element {
  const classes = ['word'];
  if (leaf.conf != undefined && leaf.conf < 0.7) {
    classes.push('text-red-600 dark:text-red-500');
  }
  if (leaf.start !== undefined) {
    classes.push(startTimeToClassName(leaf.start));
  }

  return (
    <span
      {...attributes}
      className={classes.join(' ')}
      onClick={() => {
        // this event is handeled in player.tsx to set the time when someone clicks a word
        window.dispatchEvent(new TextClickEvent(leaf));
      }}
    >
      {children}
    </span>
  );
}

export function TranscriptionEditor({ documentId }: { documentId: string }) {
  const debugMode = useDebugMode();
  const [value, setValue] = useState<Descendant[]>([]);
  const [syncComplete, setSyncComplete] = useState<boolean>(false);

  const editor = useMemo(() => {
    const baseEditor = createEditor();
    const editorWithReact = withReact(baseEditor);
    return withAutomergeDoc(editorWithReact, Automerge.init());
  }, [documentId]);

  const url = new URL(`ws://localhost:8000/api/v1/documents/sync/${documentId}/`);
  const authToken = localStorage.getItem('auth');
  url.searchParams.append('authorization', `Token ${authToken}`);

  const [_location, navigate] = useLocation();

  useEffect(() => {
    const provider = new AutomergeWebsocketProvider(url.href);

    provider.on('initalSyncComplete', () => {
      setSyncComplete(true);
      if (editor.doc.version !== 1) {
        alert('The document is in an unsupported version.');
        navigate('/');
      }
    });

    provider.on('update', ({ change, remote }: { change: Uint8Array; remote: boolean }) => {
      if (!remote) return;

      // skip own changes
      // TODO: filter own changes in backend?
      if (Automerge.decodeChange(change).actor == Automerge.getActorId(editor.doc)) return;

      const [newDoc] = Automerge.applyChanges(editor.doc, [change]);
      editor.setDoc(newDoc);
    });

    provider.on('fullDoc', (fullDoc: Uint8Array) => editor.setDoc(Automerge.load(fullDoc)));

    editor.onDocChange = (newDoc) => {
      const lastChange = Automerge.getLastLocalChange(newDoc);
      if (lastChange) {
        provider.emit('update', [{ change: lastChange, remote: false }]);
      }
    };
  }, [editor]);

  useEffect(() => {
    const preventCtrlS = (e: KeyboardEvent) => {
      const ctrlOrCmd = window.navigator.platform.match('Mac') ? e.metaKey : e.ctrlKey;
      if (ctrlOrCmd && e.key === 's') {
        e.preventDefault();
        console.log('CommandOrControl + S prevented – we automatically save the document anyways');
      }
    };
    document.addEventListener('keydown', preventCtrlS);
    return () => document.removeEventListener('keydown', preventCtrlS);
  }, []);

  return (
    <>
      <div className="flex justify-end w-full">
        <SecondaryButton
          className="my-4"
          onClick={() =>
            showModal(<WebvttExportModal editor={editor} onClose={() => showModal(null)} />)
          }
          disabled={editor.doc.children === undefined || !canGenerateVtt(editor.doc.children)}
        >
          Export as WebVTT
        </SecondaryButton>
      </div>

      <div className={clsx(syncComplete || 'blur', 'pb-40')}>
        <Slate editor={editor} value={value} onChange={setValue}>
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

      <Suspense>{debugMode && <LazyDebugPanel editor={editor} value={value} />}</Suspense>
      <PlayerBar documentId={documentId} documentContent={value} />
    </>
  );
}
