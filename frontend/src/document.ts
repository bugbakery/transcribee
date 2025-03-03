import { Document, EditorDocument } from './editor/types';
// import { next as Automerge } from '@automerge/automerge';
// import * as AutomergeStable from '@automerge/automerge';

export function documentToJSON(doc: EditorDocument): Document {
  return doc.toJSON().root;
}

// function convertString(s: string): string {
//   // this typecasting is a hack to avoid having multiple types for different versions for now
//   return new AutomergeStable.Text(s.toString()) as unknown as string;
// }

// export function migrateDocument(doc: Automerge.Doc<Document>): Automerge.Doc<Document> {
//   let theDoc = doc;
//   const v1 = theDoc.version === 1;
//   const actorID = Automerge.getActorId(doc);
//   if (v1) {
//     theDoc = AutomergeStable.load(Automerge.save(doc), actorID);
//   }
//   if (theDoc.version === 2) {
//     return doc;
//   }
//   const migratedDoc = AutomergeStable.change(theDoc, (doc: Document) => {
//     switch (doc.version) {
//       case 1:
//         for (const speakerID of Object.keys(doc.speaker_names)) {
//           doc.speaker_names[speakerID] = convertString(doc.speaker_names[speakerID]);
//         }

//         doc.children.forEach((paragraph) => {
//           paragraph.type = convertString(paragraph.type) as 'paragraph';
//           paragraph.speaker = paragraph.speaker ? convertString(paragraph.speaker) : null;
//           paragraph.lang = convertString(paragraph.lang.toString());

//           paragraph.children.forEach((child) => {
//             const start = child.start;
//             child.start = start;
//             const end = child.end;
//             child.end = end;
//             const conf = child.conf;
//             child.conf = conf;
//             child.text = convertString(child.text.toString());
//           });
//         });
//         doc.version = 2;
//       // falls through
//       case 2:
//         break;
//     }
//   });

//   if (v1) {
//     return Automerge.load(AutomergeStable.save(migratedDoc), actorID);
//   } else {
//     return migratedDoc;
//   }
// }
