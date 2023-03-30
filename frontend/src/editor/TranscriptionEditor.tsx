import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { BaseEditor, createEditor, Descendant, Editor } from 'slate';
import { withReact, Slate, Editable, RenderElementProps, RenderLeafProps } from 'slate-react';
import * as Automerge from '@automerge/automerge';
import { AutomergeWebsocketProvider } from './AutomergeWebsocketProvider';
import { useDebugMode } from '../debugMode';
import { toSlateOp } from '@slate-collaborative/bridge/src/convert';
import { applyOperation } from '@slate-collaborative/bridge/src/apply';

import { Document } from './types';

const LazyDebugPanel = lazy(() => import('./DebugPanel'));

function renderElement({ element, children, attributes }: RenderElementProps): JSX.Element {
  if (element.type === 'paragraph') {
    return (
      <div className="mb-6 flex">
        <div contentEditable={false} className="w-48 mr-8">
          {element.speaker} {'['}
          {element.children[0].start}
          {'-->'}
          {element.children[0].end}
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

type EditorAutomergeProps = { isRemote: boolean };

function withAutomerge<T extends BaseEditor>(e: T): T & EditorAutomergeProps {
  const editor = e as T & EditorAutomergeProps;
  editor.isRemote = false;
  return editor;
}

const appliedOperations: any[] = [];

export default function TranscriptionEditor({ documentId }: { documentId: string }) {
  const debugMode = useDebugMode();
  const [value, setValue] = useState<Descendant[]>([]);
  const [doc, setDoc] = useState<Automerge.Doc<Document>>(Automerge.init());
  const currentDoc = useRef<Automerge.Doc<Document>>(Automerge.init());
  const [syncComplete, setSyncComplete] = useState<boolean>(false);

  currentDoc.current = doc;

  const editor = useMemo(() => {
    const baseEditor = createEditor();
    const editorWithReact = withReact(baseEditor);
    return withAutomerge(editorWithReact);
  }, []);

  useEffect(() => {
    console.log('Initing provider');
    const provider = new AutomergeWebsocketProvider(
      `ws://localhost:8000/sync/documents/${documentId}/`,
    );

    provider.on('update', ({ change, remote }: { change: Uint8Array; remote: boolean }) => {
      if (!remote) return;

      const [newDoc] = Automerge.applyChanges(currentDoc.current, [change], {
        patchCallback: (patches, opts) => {
          editor.isRemote = true;

          Editor.withoutNormalizing(editor, () => {
            const operations = toSlateOp(patches, opts.before);
            operations.forEach((op) => {
              if (op.type === 'set_node' && op.path.length == 0) return;
              try {
                appliedOperations.push(op);
                editor.apply(op);
              } catch (e) {
                console.error(e, 'apply failed', { op });
              }
            });
          });

          Promise.resolve().then((_) => (editor.isRemote = false));
        },
      });

      setDoc(newDoc);
      currentDoc.current = newDoc;
    });

    provider.on('initalSyncComplete', () => {
      setSyncComplete(true);
    });

    const oldOnChange = editor.onChange;
    editor.onChange = (options) => {
      if (!editor.isRemote) {
        console.log('onchange', options);
        if (options?.operation) {
          const operation = options.operation;
          const newDoc = Automerge.change(currentDoc.current, (draft) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            applyOperation(draft as any, operation);
          });
          currentDoc.current = newDoc;
          setDoc(newDoc);

          const lastChange = Automerge.getLastLocalChange(newDoc);
          if (lastChange) {
            provider.emit('update', [{ change: lastChange, remote: false }]);
          }
        }
      }

      oldOnChange(options);
    };
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
        <Editable renderElement={renderElement} renderLeaf={renderLeaf} />
      </Slate>
      <Suspense>{debugMode && <LazyDebugPanel editor={editor} value={value} doc={doc} />}</Suspense>
    </div>
  );
}
