import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { createEditor, Descendant } from 'slate';
import { withReact, Slate, Editable, RenderElementProps, RenderLeafProps } from 'slate-react';
import * as Automerge from '@automerge/automerge';
import { AutomergeWebsocketProvider } from './automerge_websocket_provider';
import { useDebugMode } from '../debugMode';

import { Document } from './types';

const LazyDebugPanel = lazy(() =>
  import('./debug_panel').then((module) => ({ default: module.DebugPanel })),
);

function getSpeakerName(speaker_id: number, speaker_names: Record<number, string>): string {
  if (speaker_id in speaker_names) {
    return speaker_names[speaker_id];
  } else {
    return `Speaker ${speaker_id + 1}`;
  }
}
function getSpeakerNames(speaker_ids: number[], speaker_names: Record<number, string>): string {
  if (speaker_ids.length > 0) {
    return speaker_ids.map((id) => getSpeakerName(id, speaker_names)).join(', ');
  } else {
    return 'Unknown Speaker';
  }
}

function renderElement(
  { element, children, attributes }: RenderElementProps,
  doc: Automerge.Doc<Document>,
): JSX.Element {
  if (element.type === 'paragraph') {
    const para_start = element.children[0].start;
    const para_end = element.children[element.children.length - 1].end;
    return (
      <div className="mb-6 flex">
        <div contentEditable={false} className="w-48 mr-8">
          {getSpeakerNames(element.speakers, doc)} {'['}
          {para_start}
          {'-->'}
          {para_end}
          {']'}
        </div>
        <div {...attributes} className="grow-1 basis-full">
          {children}
        </div>
      </div>
    );
  }

  throw Error('Unknown element type');
}

function renderLeaf({ leaf, children, attributes }: RenderLeafProps): JSX.Element {
  const classes = [];
  if (leaf.conf != undefined && leaf.conf < 0.7) {
    classes.push('text-red-500');
  }

  return (
    <span {...attributes} className={classes.join(' ')}>
      {children}
    </span>
  );
}

export function TranscriptionEditor({ documentId }: { documentId: string }) {
  const debugMode = useDebugMode();
  const [value, setValue] = useState<Descendant[]>([]);
  const [doc, setDoc] = useState<Automerge.Doc<Document>>(Automerge.init());
  const currentDoc = useRef<Automerge.Doc<Document>>(Automerge.init());
  const [syncComplete, setSyncComplete] = useState<boolean>(false);

  currentDoc.current = doc;

  const editor = useMemo(() => {
    const baseEditor = createEditor();
    const editorWithReact = withReact(baseEditor);

    return editorWithReact;
  }, []);

  useEffect(() => {
    console.log('Initing provider');
    const provider = new AutomergeWebsocketProvider(
      `ws://localhost:8000/sync/documents/${documentId}/`,
    );
    provider.on('update', (change: Uint8Array) => {
      const [newDoc] = Automerge.applyChanges(currentDoc.current, [change], {
        patchCallback: (x) => console.debug('automerge patches', x),
      });
      setDoc(newDoc);
      currentDoc.current = newDoc;
      if (newDoc.paragraphs) {
        if ('paragraphs' in newDoc) {
          const children = [...editor.children];

          children.forEach((node) => editor.apply({ type: 'remove_node', path: [0], node }));

          newDoc.paragraphs
            .filter((x) => x)
            .forEach((node, i) => {
              editor.apply({ type: 'insert_node', path: [i], node: node });
            });
        }
      }
    });
    provider.on('initalSyncComplete', () => setSyncComplete(true));
  }, []);

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
    <div className={syncComplete ? '' : 'blur'}>
      <Slate editor={editor} value={value} onChange={setValue}>
        <Editable renderElement={(props) => renderElement(props, doc)} renderLeaf={renderLeaf} />
      </Slate>

      <Suspense>{debugMode && <LazyDebugPanel editor={editor} value={value} doc={doc} />}</Suspense>
    </div>
  );
}
