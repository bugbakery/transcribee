import { useLocation } from 'wouter';
import { useEffect, useRef, useState } from 'react';
import { Editor, createEditor } from 'slate';
import { withHistory, HistoryEditor } from 'slate-history';
import { withReact } from 'slate-react';
import { withAutomergeDoc } from 'slate-automerge-doc';
import { next as Automerge } from '@automerge/automerge';
import ReconnectingWebSocket from 'reconnecting-websocket';
import { useDebugMode } from '../debugMode';
import { Document, Paragraph } from './types';
import { migrateDocument } from '../document';

enum MessageSyncType {
  Change = 1,
  ChangeBacklogComplete = 2,
  FullDoc = 3,
}

export type EditorWithWebsocket = Editor & {
  update: (changeFn: (doc: Document) => void) => void;
};

export function useAutomergeWebsocketEditor(
  url: string,
  { onInitialSyncComplete }: { onInitialSyncComplete: (editor?: Editor) => void },
): [EditorWithWebsocket?, Paragraph[]?] {
  const debug = useDebugMode();
  const sentChanges = useRef<Set<string>>(new Set());
  const [editorAndInitialValue, setEditorAndInitialValue] = useState<null | {
    editor: EditorWithWebsocket;
    initialValue: Paragraph[];
  }>(null);
  const editorRef = useRef<undefined | Editor>();
  if (editorRef.current !== editorAndInitialValue?.editor)
    editorRef.current = editorAndInitialValue?.editor;
  const wsRef = useRef<ReconnectingWebSocket | null>(null);

  function sendDocChange(newDoc: Document) {
    const lastChange = Automerge.getLastLocalChange(newDoc);
    if (lastChange && wsRef.current) {
      const decoded = Automerge.decodeChange(lastChange);
      if (!sentChanges.current.has(decoded.hash)) {
        wsRef.current.send(lastChange);
        sentChanges.current.add(decoded.hash);
      }
    }
  }

  const [_, navigate] = useLocation();

  useEffect(() => {
    const ws = new ReconnectingWebSocket(url, [], { debug });

    let bytesReceived = 0;
    console.time('initialSync');
    let doc = Automerge.init();

    const createNewEditor = (doc: Automerge.Doc<Document>) => {
      const baseEditor = createEditor();
      const editorWithReact = withReact(baseEditor);
      const editor = withHistory(
        withAutomergeDoc(editorWithReact, Automerge.init()),
      ) as EditorWithWebsocket;
      editor.addDocChangeListener(sendDocChange);

      const migratedDoc = migrateDocument(doc as Automerge.Doc<Document>);
      sendDocChange(migratedDoc);
      editor.doc = migratedDoc;

      onInitialSyncComplete(editor);
      setEditorAndInitialValue((oldValue) => {
        oldValue?.editor.removeDocChangeListener(sendDocChange);
        const initialValue =
          migratedDoc.children !== undefined
            ? JSON.parse(JSON.stringify(migratedDoc.children))
            : [];

        editor.update = (changeFn: (doc: Document) => void) => {
          console.time('changeFn');
          const changed = Automerge.change(editor.doc, changeFn);
          console.timeEnd('changeFn');
          console.time('setDoc');
          editor.setDoc(changed);
          console.timeEnd('setDoc');
          console.time('sendDocChange');
          sendDocChange(changed);
          console.timeEnd('sendDocChange');
        };
        return { editor: editor, initialValue: initialValue };
      });
    };

    const onMessage = async (event: MessageEvent) => {
      const msg_data = new Uint8Array(await event.data.arrayBuffer());
      bytesReceived += msg_data.length;
      const msg_type = msg_data[0];
      const msg = msg_data.slice(1);
      if (msg_type === MessageSyncType.Change) {
        if (
          !editorRef.current ||
          Automerge.decodeChange(msg).actor == Automerge.getActorId(editorRef.current.doc)
        )
          return;

        console.time('automerge');
        const [newDoc] = Automerge.applyChanges(editorRef.current.doc, [msg]);
        console.timeEnd('automerge');
        console.time('setDoc');
        HistoryEditor.withoutSaving(editorRef.current, () => {
          editorRef.current?.setDoc(newDoc);
        });
        console.timeEnd('setDoc');
      } else if (msg_type === MessageSyncType.ChangeBacklogComplete) {
        console.info('backlog complete');
        onInitialSyncComplete(editorRef.current);
      } else if (msg_type === MessageSyncType.FullDoc) {
        console.info('Received new document');
        console.time('automerge');
        doc = Automerge.load(msg, { allowMissingChanges: true });
        console.timeEnd('automerge');
        createNewEditor(doc as Automerge.Doc<Document>);
        console.info(`ws: ${(bytesReceived / 1e6).toFixed(2)} MB recieved so far`);
        console.info('Loaded new document');
      }
    };
    ws.addEventListener('message', (msg) => {
      onMessage(msg).catch((e) => {
        alert(`error while loading automerge message occured: ${e}`);
        navigate('/');
      });
    });

    wsRef.current = ws;

    return () => {
      wsRef.current = null;
      ws.close();
    };
  }, [url, setEditorAndInitialValue]);

  return [editorAndInitialValue?.editor, editorAndInitialValue?.initialValue];
}
