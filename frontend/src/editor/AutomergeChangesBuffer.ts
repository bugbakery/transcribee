import * as Automerge from '@automerge/automerge';

export class AutomergeChangesBuffer {
  lastSeq = 0;
  bufferedUpdates: Record<number, Automerge.Change[]> = {};
  missedUpdates: Automerge.Change[] = [];

  receive = (change: Automerge.Change) => {
    const seq = Automerge.decodeChange(change).seq;

    if (seq <= this.lastSeq) {
      this.missedUpdates.push(change);
    } else {
      if (!this.bufferedUpdates[seq]) {
        this.bufferedUpdates[seq] = [];
      }
      this.bufferedUpdates[seq].push(change);
    }
  };

  consumeChanges = (seq: number) => {
    const currentChanges = this.bufferedUpdates[seq];

    if (currentChanges) {
      delete this.bufferedUpdates[seq];
    }

    return currentChanges;
  };

  collectChanges = () => {
    const changes = [];

    changes.push(...this.missedUpdates);
    this.missedUpdates = [];

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const currentChanges = this.consumeChanges(this.lastSeq + 1);
      if (!currentChanges) {
        break;
      }

      changes.push(...currentChanges);
      this.lastSeq++;
    }

    return changes;
  };
}
