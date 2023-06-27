import { useLocation } from 'wouter';
import { useEffect, useMemo, useRef } from 'react';
import { Editor, createEditor } from 'slate';
import { withReact } from 'slate-react';
import { withAutomergeDoc } from 'slate-automerge-doc';
import { unstable as Automerge } from '@automerge/automerge';
import ReconnectingWebSocket from 'reconnecting-websocket';
import { useDebugMode } from '../debugMode';
import { Document } from './types';
import { migrateDocument } from '../document';

enum MessageSyncType {
  Change = 1,
  ChangeBacklogComplete = 2,
  FullDoc = 3,
}

export function useAutomergeWebsocketEditor(
  url: string | URL,
  { onInitialSyncComplete }: { onInitialSyncComplete: () => void },
): Editor {
  const debug = useDebugMode();

  const editor = useMemo(() => {
    const baseEditor = createEditor();
    const editorWithReact = withReact(baseEditor);
    const editorWithAutomerge = withAutomergeDoc(editorWithReact, Automerge.init());
    return editorWithAutomerge;
  }, [url.toString()]);

  const wsRef = useRef<ReconnectingWebSocket | null>(null);

  function sendDocChange(newDoc: Document) {
    const lastChange = Automerge.getLastLocalChange(newDoc);
    if (lastChange && wsRef.current) {
      wsRef.current.send(lastChange);
    }
  }

  const [_, navigate] = useLocation();

  useEffect(() => {
    const ws = new ReconnectingWebSocket(url.toString(), [], { debug });

    let bytesReceived = 0;
    console.time('initialSync');
    let initialSync = true;
    let doc = Automerge.init();

    const migrateAndSetDoc = (doc: Automerge.Doc<Document>) => {
      const migratedDoc = migrateDocument(doc as Automerge.Doc<Document>);
      sendDocChange(migratedDoc);

      console.time('setDoc');
      editor.setDoc(migratedDoc);
      console.timeEnd('setDoc');
    };

    const onMessage = async (event: MessageEvent) => {
      const msg_data = new Uint8Array(await event.data.arrayBuffer());
      bytesReceived += msg_data.length;
      const msg_type = msg_data[0];
      const msg = msg_data.slice(1);
      if (msg_type === MessageSyncType.Change) {
        // skip own changes
        // TODO: filter own changes in backend?
        if (Automerge.decodeChange(msg).actor == Automerge.getActorId(editor.doc)) return;

        if (initialSync) {
          console.time('automerge');
          const [newDoc] = Automerge.applyChanges(doc, [msg]);
          console.timeEnd('automerge');
          doc = newDoc;
        } else {
          console.time('automerge');
          const [newDoc] = Automerge.applyChanges(editor.doc, [msg]);
          console.timeEnd('automerge');
          console.time('setDoc');
          editor.setDoc(newDoc);
          console.timeEnd('setDoc');
        }
      } else if (msg_type === MessageSyncType.ChangeBacklogComplete) {
        console.info('backlog complete');
        initialSync = false;
        migrateAndSetDoc(doc as Automerge.Doc<Document>);
        console.timeEnd('initialSync');
        console.info(`ws: ${(bytesReceived / 1e6).toFixed(2)} MB recieved so far`);
        onInitialSyncComplete();
      } else if (msg_type === MessageSyncType.FullDoc) {
        console.info('Received new document');
        console.time('automerge');
        doc = Automerge.load(msg);
        console.timeEnd('automerge');
        if (!initialSync) {
          // for some reason, firefox sometimes receives the messages out of order.
          // This works around that problem
          migrateAndSetDoc(doc as Automerge.Doc<Document>);
          console.info(`ws: ${(bytesReceived / 1e6).toFixed(2)} MB recieved so far`);
        }
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
  }, [editor]);

  useEffect(() => {
    editor.addDocChangeListener(sendDocChange);
    return () => editor.removeDocChangeListener(sendDocChange);
  }, [editor]);

  return editor;
}
