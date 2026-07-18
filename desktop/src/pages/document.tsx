import { RouteComponentProps } from 'wouter';
import { useEffect, useRef, useState } from 'react';
import { Editor, createEditor } from 'slate';
import { withHistory } from 'slate-history';
import { withReact } from 'slate-react';
import { withAutomergeDoc } from 'slate-automerge-doc';
import { next as Automerge } from '@automerge/automerge';
import { Document, Paragraph } from 'transcribee-ui-common/editor/types';
import { migrateDocument } from 'transcribee-ui-common/editor/migrate_document';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { TranscriptionEditor } from 'transcribee-ui-common/editor/transcription_editor';
import { PlayerBar } from 'transcribee-ui-common/editor/player';

export function useAutomergeLocalFileEditor(documentPath: string): [Editor?, Paragraph[]?] {
  const [editorAndInitialValue, setEditorAndInitialValue] = useState<null | {
    editor: Editor;
    initialValue: Paragraph[];
  }>(null);
  const editorRef = useRef<undefined | Editor>(undefined);
  if (editorRef.current !== editorAndInitialValue?.editor)
    editorRef.current = editorAndInitialValue?.editor;

  function sendDocChange(_newDoc: Document) {
    console.log('todo: handle change');
  }

  useEffect(() => {
    let doc = Automerge.init();

    const createNewEditor = (doc: Automerge.Doc<Document>) => {
      const baseEditor = createEditor();
      const editorWithReact = withReact(baseEditor);
      const editor = withHistory(withAutomergeDoc(editorWithReact, Automerge.init()));
      editor.addDocChangeListener(sendDocChange);

      const migratedDoc = migrateDocument(doc as Automerge.Doc<Document>);
      sendDocChange(migratedDoc);
      editor.doc = migratedDoc;

      setEditorAndInitialValue((oldValue) => {
        oldValue?.editor.removeDocChangeListener(sendDocChange);
        const initialValue =
          migratedDoc.children !== undefined
            ? JSON.parse(JSON.stringify(migratedDoc.children))
            : [];
        return { editor: editor, initialValue: initialValue };
      });
    };

    (async () => {
      const document_bytes: ArrayBuffer = await invoke('read_automerge', { path: documentPath });
      console.time('automerge load full doc');
      const newDoc = Automerge.load(new Uint8Array(document_bytes), { allowMissingChanges: true });
      console.timeEnd('automerge load full doc');
      doc = newDoc;
      createNewEditor(doc as Automerge.Doc<Document>);
    })();

    return () => {};
  }, [documentPath, setEditorAndInitialValue]);

  return [editorAndInitialValue?.editor, editorAndInitialValue?.initialValue];
}

export function DocumentPage({
  params: { '*': documentPath },
}: RouteComponentProps<{ '*': string }>) {
  const [editor, initialValue] = useAutomergeLocalFileEditor(documentPath);
  const file_url = convertFileSrc(`${documentPath}/media`, 'archive');

  return (
    <div className="max-w-screen-xl p-6 mx-auto flex flex-col border-box">
      <div className="pb-6">{documentPath}</div>
      <TranscriptionEditor
        editor={editor}
        initialValue={initialValue}
        className={'grow flex flex-col'}
        readOnly={false}
      >
        {editor && (
          <PlayerBar
            documentId={documentPath}
            editor={editor}
            mediaFiles={[
              {
                content_type: 'audio/mpeg', // TODO: handle this properly once we have the media handling in place
                tags: [],
                url: file_url,
              },
            ]}
          />
        )}
      </TranscriptionEditor>
    </div>
  );
}
