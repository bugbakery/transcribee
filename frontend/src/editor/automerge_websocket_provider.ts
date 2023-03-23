import { Observable } from 'lib0/observable';
import { Change } from '@automerge/automerge';

enum MessageSyncType {
  Change = 1,
  ChangeBacklogComplete = 2,
  FullDoc = 3,
}

export class AutomergeWebsocketProvider extends Observable<
  'update' | 'initalSyncComplete' | 'fullDoc'
> {
  ws!: WebSocket;
  url: string;

  constructor(url: string) {
    super();

    this.url = url;

    this.connectWebsocket();

    this.on('update', ({ change, remote }: { change: Change; remote: boolean }) => {
      if (remote) return;
      this.ws.send(change);
    });
  }

  connectWebsocket() {
    this.ws = new WebSocket(this.url);

    this.ws.addEventListener('open', (e) => {
      console.debug('[ws] Connected', e);
    });

    this.ws.addEventListener('message', async (event: MessageEvent) => {
      const msg_data = new Uint8Array(await event.data.arrayBuffer());
      const msg_type = msg_data[0];
      const msg = msg_data.slice(1);
      if (msg_type === MessageSyncType.Change) {
        this.emit('update', [{ change: msg, remote: true }]);
      } else if (msg_type === MessageSyncType.ChangeBacklogComplete) {
        this.emit('initalSyncComplete', []);
        console.log('All changes synced');
      } else if (msg_type === MessageSyncType.FullDoc) {
        this.emit('fullDoc', [msg]);
        console.log('Received new document');
      }
    });

    this.ws.addEventListener('close', () => setTimeout(() => this.connectWebsocket(), 1000));
  }
}
