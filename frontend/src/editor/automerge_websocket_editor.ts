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

  useEffect(() => {
    const ws = new ReconnectingWebSocket(url.toString(), [], { debug });
    const start = Date.now();
    let initialSync = true;
    let doc = Automerge.init();

    const onMessage = async (event: MessageEvent) => {
      const msg_data = new Uint8Array(await event.data.arrayBuffer());
      const msg_type = msg_data[0];
      const msg = msg_data.slice(1);
      if (msg_type === MessageSyncType.Change) {
        // skip own changes
        // TODO: filter own changes in backend?
        if (Automerge.decodeChange(msg).actor == Automerge.getActorId(editor.doc)) return;

        if (initialSync) {
          const [newDoc] = Automerge.applyChanges(doc, [msg]);
          doc = newDoc;
        } else {
          const [newDoc] = Automerge.applyChanges(editor.doc, [msg]);
          editor.setDoc(newDoc);
        }
      } else if (msg_type === MessageSyncType.ChangeBacklogComplete) {
        initialSync = false;
        console.log(`All changes synced in ${(Date.now() - start) / 1000} s`);

        const migratedDoc = migrateDocument(doc as Automerge.Doc<Document>);
        sendDocChange(migratedDoc);
        editor.setDoc(migratedDoc);
        onInitialSyncComplete();
      } else if (msg_type === MessageSyncType.FullDoc) {
        console.log('Received new document');
        doc = Automerge.load(msg);
        console.log('Loaded new document');
      }
    };
    ws.addEventListener('message', (msg) => {
      onMessage(msg);
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
