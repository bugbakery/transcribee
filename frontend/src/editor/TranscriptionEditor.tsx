import React, { useEffect, useMemo, useState } from 'react';
import { createEditor, Descendant } from 'slate';
import { withReact, Slate, Editable, RenderElementProps, RenderLeafProps } from 'slate-react';
import * as Y from 'yjs';
import { withYjs, withYHistory, YjsEditor } from '@slate-yjs/core';
import { WebsocketProvider } from './WebsocketProvider';
import { useDebugMode } from '../debugMode';

const LazyDebugPanel = React.lazy(() => import('./DebugPanel'));

function renderElement({ element, children, attributes }: RenderElementProps): JSX.Element {
  if (element.type === 'paragraph') {
    return (
      <div className="mb-6 flex">
        <div contentEditable={false} className="w-48 mr-8">
          {element.speaker}
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

export default function TranscriptionEditor() {
  const debugMode = useDebugMode();
  const [value, setValue] = useState<Descendant[]>([]);
  const [syncComplete, setSyncComplete] = useState<boolean>(false);

  const yDoc = useMemo(() => {
    console.log('new yDoc');
    const doc = new Y.Doc();

    const documentId = new URLSearchParams(location.search).get('doc');

    if (documentId) {
      const provider = new WebsocketProvider(
        `ws://localhost:8000/sync/documents/${documentId}/`,
        doc,
      );
      provider.on('initalSyncComplete', () => setSyncComplete(true));
    }

    return doc;
  }, []);

  const editor = useMemo(() => {
    const baseEditor = createEditor();
    const editorWithReact = withReact(baseEditor);

    const sharedRoot = yDoc.get('content', Y.XmlText) as Y.XmlText;
    const editorWithYjs = withYHistory(withYjs(editorWithReact, sharedRoot));

    return editorWithYjs;
  }, []);

  useEffect(() => {
    YjsEditor.connect(editor);
    return () => YjsEditor.disconnect(editor);
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
    <div className={syncComplete ? '' : 'blur'}>
      <Slate editor={editor} value={value} onChange={setValue}>
        <Editable renderElement={renderElement} renderLeaf={renderLeaf} />
      </Slate>

      {debugMode && <LazyDebugPanel editor={editor} value={value} yDoc={yDoc} />}
    </div>
  );
}
