import { useEffect, useMemo, useRef } from 'react';
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

const PRESENCE_INTERVAL = 27 * 1000;
const PRESENCE_TIMEOUT = 60 * 1000;

interface PresenceMessage {
  actorID: string,
  selection: BaseSelection
}

export function useAutomergeWebsocketEditor(
  url: string | URL,
  { onInitialSyncComplete }: { onInitialSyncComplete: () => void },
): Editor {
  const debug = useDebugMode();

  const editor = useMemo(() => {
    const baseEditor = createEditor();
    const editorWithReact = withReact(baseEditor);
    return withAutomergeDoc(editorWithReact, Automerge.init());
  }, [url.toString()]);

  const wsRef = useRef<ReconnectingWebSocket | null>(null);
  useEffect(() => {
    const actorID = Automerge.getActorId(editor.doc);
    let presenceTimer: number | null = null;

    function sendPresence() {
      const message: PresenceMessage = {
        actorID,
        selection: editor.selection
      };
      console.log("sending", message);
      ws.send(JSON.stringify(message));

      presenceTimer && window.clearTimeout(presenceTimer);
      presenceTimer = window.setTimeout(sendPresence, PRESENCE_INTERVAL);
    }

    const ws = new ReconnectingWebSocket(url.toString(), [], { debug });
    ws.binaryType = "arraybuffer";
    const start = Date.now();
    let initialMessages: Uint8Array[] = [];
    let initialSync = true;

    sendPresence();

    const onChange = editor.onChange;
    editor.onChange = (...args) => {
      sendPresence() // TODO(robin): debounce
      onChange && onChange(...args);
    };

    const onMessage = async (event: MessageEvent) => {
      console.log(event);
      const msg_data = new Uint8Array(await event.data);
      const msg_type = msg_data[0];
      const msg = msg_data.slice(1);
      if (msg_type === MessageSyncType.Change) {
        // skip own changes
        // TODO: filter own changes in backend?
        if (Automerge.decodeChange(msg).actor == actorID) return;

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

  editor.onDocChange = (newDoc) => {
    const lastChange = Automerge.getLastLocalChange(newDoc);
    if (lastChange && wsRef.current) {
      wsRef.current.send(lastChange);
    }
  };

  return editor;
}
