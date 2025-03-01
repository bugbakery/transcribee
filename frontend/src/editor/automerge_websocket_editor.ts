import { useLocation } from 'wouter';
import { useEffect, useRef, useState } from 'react';
import { Editor, createEditor } from 'slate';
import { withReact } from 'slate-react';
import ReconnectingWebSocket from 'reconnecting-websocket';
import { useDebugMode } from '../debugMode';
import { Document, Paragraph } from './types';
import { withLoroDoc } from './slate_loro';
import { LoroDoc } from 'loro-crdt';

enum MessageSyncType {
  Change = 1,
  ChangeBacklogComplete = 2,
  FullDoc = 3,
}

export function useAutomergeWebsocketEditor(
  url: string,
  { onInitialSyncComplete }: { onInitialSyncComplete: (editor?: Editor) => void },
): [Editor?, Paragraph[]?] {
  const debug = useDebugMode();
  const [editorAndInitialValue, setEditorAndInitialValue] = useState<null | {
    editor: Editor;
    initialValue: Paragraph[];
  }>(null);
  const editorRef = useRef<undefined | Editor>();
  if (editorRef.current !== editorAndInitialValue?.editor)
    editorRef.current = editorAndInitialValue?.editor;
  const wsRef = useRef<ReconnectingWebSocket | null>(null);

  function sendDocChange(change: Uint8Array) {
    wsRef.current?.send(change);
  }

  const [_, navigate] = useLocation();

  useEffect(() => {
    const ws = new ReconnectingWebSocket(url, [], { debug });

    let bytesReceived = 0;
    console.time('initialSync');

    const createNewEditor = (doc: LoroDoc) => {
      const baseEditor = createEditor();
      const editorWithReact = withReact(baseEditor);

      doc.subscribeLocalUpdates(sendDocChange)
      // editor.addDocChangeListener(sendDocChange);

      const editor = withLoroDoc(editorWithReact, doc);
      editor.doc = doc;

      onInitialSyncComplete(editor);

      setEditorAndInitialValue((oldValue) => {
        // oldValue?.editor.removeDocChangeListener(sendDocChange);
        // const initialValue =
        //   doc.children !== undefined
        //     ? JSON.parse(JSON.stringify(migratedDoc.children))
        //     : [];
        return { editor: editor, initialValue: editor.doc.toJSON().root.children };
      });
    };

    const onMessage = async (event: MessageEvent) => {
      let msg_data = new Uint8Array(await event.data.arrayBuffer());
      bytesReceived += msg_data.length;
      const updates = [];
      let idx = 0;
      let backlogComplete = false;
      let fullDoc = false;
      console.log("message", msg_data)
      while (idx < msg_data.length) {
        const msg_type = msg_data[idx];
        idx += 1;
        if ((msg_type === MessageSyncType.Change) || (msg_type === MessageSyncType.FullDoc)) {
          let msg_len = msg_data[idx + 0];
          msg_len = (msg_len << 8) + msg_data[idx + 1];
          msg_len = (msg_len << 8) + msg_data[idx + 2];
          msg_len = (msg_len << 8) + msg_data[idx + 3];

          // const msg_len = ((((msg_data[idx + 0] << 8 + msg_data[idx + 1]) << 8) + msg_data[idx + 2]) << 8) + msg_data[idx + 3];
          console.log(msg_len, msg_data[idx + 0], msg_data[idx + 1], msg_data[idx + 2], msg_data[idx + 3])
          idx += 4;
          updates.push(msg_data.slice(idx, idx + msg_len))
          idx += msg_len

          // if (
          //   !editorRef.current ||
          //   Automerge.decodeChange(msg).actor == Automerge.getActorId(editorRef.current.doc)
          // )
          //   return;

          // HistoryEditor.withoutSaving(editorRef.current, () => {
          //   editorRef.current?.setDoc(newDoc);
          // });

        } else if (msg_type === MessageSyncType.ChangeBacklogComplete) {
          backlogComplete = true;
          console.info('backlog complete');
          break;
        } else if (msg_type === MessageSyncType.FullDoc) {
          fullDoc = true;
        }
      }

      // TODO(robin): HACK
      if ((fullDoc || !editorRef.current) && updates.length > 0) {
        const doc = new LoroDoc()
        console.time('importBatch');
        console.log(updates)
        console.log(doc.importBatch(updates));
        console.timeEnd('importBatch');

        createNewEditor(doc);
      } else {
        if (updates.length > 0) {
          console.time('importBatch');
          editorRef.current?._doc.importBatch(updates);
          console.timeEnd('importBatch');
        }
      }

      if (backlogComplete) {
        onInitialSyncComplete(editorRef.current);
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
