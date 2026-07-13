import { Document } from './editor/types';
import { next as Automerge } from '@automerge/automerge';
import * as AutomergeStable from '@automerge/automerge';

function convertString(s: string): string {
  // previously we added some fields as automerge immutable strings. Since version 3.0 the automerge
  // js api treats js strings as collaborative text. Reading, calling .toString() on a member and
  // writing it back converts it to a collaborative text.
  return s.toString();
}

function ensureFloatChild<T>(obj: T, member: keyof T) {
  // this is only working in the specific context of obj being an automerge document.
  // because the automerge js api gives every number as a number. Reading and writing it back
  // causes the number to become a float.
  const v = obj[member];
  obj[member] = v;
}

export function migrateDocument(doc: Automerge.Doc<Document>): Automerge.Doc<Document> {
  let theDoc = doc;
  const v1 = theDoc.version === 1;
  const actorID = Automerge.getActorId(doc);
  if (v1) {
    theDoc = AutomergeStable.load(Automerge.save(doc), actorID);
  }
  if (theDoc.version === 2) {
    return doc;
  }
  const migratedDoc = AutomergeStable.change(theDoc, (doc: Document) => {
    switch (doc.version) {
      case 1:
        for (const speakerID of Object.keys(doc.speaker_names)) {
          doc.speaker_names[speakerID] = convertString(doc.speaker_names[speakerID]);
        }

        doc.children.forEach((paragraph) => {
          paragraph.type = convertString(paragraph.type) as 'paragraph';
          paragraph.speaker = paragraph.speaker ? convertString(paragraph.speaker) : null;
          paragraph.lang = convertString(paragraph.lang);

          paragraph.children.forEach((child) => {
            ensureFloatChild(child, 'start');
            ensureFloatChild(child, 'end');
            ensureFloatChild(child, 'conf');
            child.text = convertString(child.text);
          });
        });
        doc.version = 2;
      // falls through
      case 2:
        break;
    }
  });

  if (v1) {
    return Automerge.load(AutomergeStable.save(migratedDoc), actorID);
  } else {
    return migratedDoc;
  }
}
