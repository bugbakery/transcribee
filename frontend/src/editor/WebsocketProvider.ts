import { Observable } from 'lib0/observable';
import * as Y from 'yjs';

export class WebsocketProvider extends Observable<'update'> {
  ws: WebSocket;

  constructor(url: string, yDoc: Y.Doc) {
    super();

    this.ws = new WebSocket(url);

    this.ws.addEventListener('open', (e) => {
      console.debug('[ws] Connected', e);
    });

    yDoc.on('update', (update, origin) => {
      if (origin !== this) {
        if (this.ws.readyState === this.ws.OPEN) {
          this.ws.send(update);
        }

        this.emit('update', [update]);
      }
    });

    this.on('update', (update: Uint8Array) => {
      Y.applyUpdate(yDoc, update, this);
    });

    this.ws.addEventListener('message', async (event: MessageEvent) => {
      const data = event.data as Blob;
      const buffer = await data.arrayBuffer();
      this.emit('update', [new Uint8Array(buffer)]);
    });
  }
}
