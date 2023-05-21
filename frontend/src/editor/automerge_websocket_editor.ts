import { useEffect, useMemo, useRef, useState } from 'react';
import { Editor, createEditor } from 'slate';
import { withReact } from 'slate-react';
import { withAutomergeDoc } from 'slate-automerge-doc';
import * as Automerge from '@automerge/automerge';
import ReconnectingWebSocket from 'reconnecting-websocket';
import { useDebugMode } from '../debugMode';

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

  // this is a hack to force a react tree rerender on changes of the document
  const [_generation, setGeneration] = useState(0);

  const editor = useMemo(() => {
    const baseEditor = createEditor();
    const editorWithReact = withReact(baseEditor);
    const editorWithAutomerge = withAutomergeDoc(editorWithReact, Automerge.init());

    const onDocChange = editorWithAutomerge.onDocChange;
    editorWithAutomerge.onDocChange = (...args) => {
      setGeneration((n) => n + 1);
      onDocChange && onDocChange(...args);
    };

    return editorWithAutomerge;
  }, [url.toString()]);

  const wsRef = useRef<ReconnectingWebSocket | null>(null);
  useEffect(() => {
    const ws = new ReconnectingWebSocket(url.toString(), [], { debug });
    const start = Date.now();
    let initialMessages: Uint8Array[] = [];
    let initialSync = true;

    const onMessage = async (event: MessageEvent) => {
      const msg_data = new Uint8Array(await event.data.arrayBuffer());
      const msg_type = msg_data[0];
      const msg = msg_data.slice(1);
      if (msg_type === MessageSyncType.Change) {
        // skip own changes
        // TODO: filter own changes in backend?
        if (Automerge.decodeChange(msg).actor == Automerge.getActorId(editor.doc)) return;

        if (initialSync) {
          initialMessages.push(msg);
        } else {
          const [newDoc] = Automerge.applyChanges(editor.doc, [msg]);
          editor.setDoc(newDoc);
        }
      } else if (msg_type === MessageSyncType.ChangeBacklogComplete) {
        const [newDoc] = Automerge.applyChanges(editor.doc, initialMessages);
        editor.setDoc(newDoc);
        console.log(`All changes synced in ${(Date.now() - start) / 1000} s`);
        initialSync = false;
        initialMessages = [];
        onInitialSyncComplete();
      } else if (msg_type === MessageSyncType.FullDoc) {
        console.log('Received new document');
        editor.setDoc(Automerge.load(msg));
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
    const onDocChange = editor.onDocChange;
    editor.onDocChange = (newDoc) => {
      const lastChange = Automerge.getLastLocalChange(newDoc);
      if (lastChange && wsRef.current) {
        wsRef.current.send(lastChange);
      }
      if (onDocChange) {
        onDocChange(newDoc);
      }
    };
  }, [editor]);


  return editor;
}
