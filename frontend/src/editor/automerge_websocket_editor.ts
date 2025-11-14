import { useLocation } from 'wouter';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Editor, createEditor } from 'slate';
import { withReact } from 'slate-react';
import ReconnectingWebSocket from 'reconnecting-websocket';
import { useDebugMode } from '../debugMode';
import { Document, Paragraph } from './types';
import { withLoroDoc } from './slate_loro';
import { LoroDoc } from 'loro-crdt';

enum MessageSyncType {
  Change = 1,
  BacklogComplete = 2,
}

function int_from_32bit_big_endian(msg_data: Uint8Array, idx: number): number {
  let to_return = msg_data[idx + 0];
  to_return = (to_return << 8) + msg_data[idx + 1];
  to_return = (to_return << 8) + msg_data[idx + 2];
  to_return = (to_return << 8) + msg_data[idx + 3];
  return to_return;
}

export function useAutomergeWebsocketEditor(
  url: string,
  { onInitialSyncComplete }: { onInitialSyncComplete: (editor?: Editor) => void },
): [Editor, Paragraph[]?] {
  const debug = useDebugMode();
  const [initialValue, setInitialValue] = useState<null | Paragraph[]>(null);
  const editor = useMemo(() => {
    const doc = new LoroDoc();
    const baseEditor = createEditor();
    const editorWithReact = withReact(baseEditor);

    doc.subscribeLocalUpdates(sendDocChange);

    const editor = withLoroDoc(editorWithReact, doc);
    editor._doc = doc;

    return editor;
  }, [url]);

  const wsRef = useRef<ReconnectingWebSocket | null>(null);

  function sendDocChange(change: Uint8Array) {
    wsRef.current?.send(change);
  }

  const [_, navigate] = useLocation();

  useEffect(() => {
    const ws = new ReconnectingWebSocket(url, [], { debug });

    console.time('initialSync');

    const updates = [];
    let initialSyncDone = false;

    const generator = messageGenerator();
    generator.next();

    async function* messageGenerator(): AsyncGenerator<void, void, Message> {
      while (true) {
        const message = yield;
        if (message) {
          const msg_data = new Uint8Array(await message.arrayBuffer());
          const msg_type = msg_data[0];

          console.log(msg_data);
          if (msg_type === MessageSyncType.Change) {
            let idx = 1;
            while (idx < msg_data.length) {
              const msg_len = int_from_32bit_big_endian(msg_data, idx);
              console.log(msg_len);
              idx += 4;
              updates.push(msg_data.slice(idx, idx + msg_len));
              idx += msg_len;
            }
            if (initialSyncDone) {
              console.time('importBatch');
              console.log(`updates:`, updates);
              console.log(editor._doc.importBatch(updates));
              console.timeEnd('importBatch');
            }
          } else if (msg_type === MessageSyncType.BacklogComplete) {
            console.time('importBatch');
            console.log(`updates:`, updates);
            console.log(editor._doc.importBatch(updates));
            console.timeEnd('importBatch');
            editor.onInitialSyncComplete();
            setInitialValue(editor._doc.getMap('root').get('children').toJSON());
            console.timeEnd('initialSync');
            onInitialSyncComplete(editor);
            console.info('backlog complete');
            initialSyncDone = true;
          }
        }
      }
    }

    const onMessage = async (event: MessageEvent) => {
      await generator.next(event.data);
    };
    ws.addEventListener('message', (msg) => {
      onMessage(msg).catch((e) => {
        console.log(`error while loading sync message occured`, e);
        alert(`error while loading sync message occured: ${e}`);
        navigate('/');
      });
    });

    wsRef.current = ws;

    return () => {
      wsRef.current = null;
      ws.close();
    };
  }, [url]);

  return [editor, initialValue];
}
