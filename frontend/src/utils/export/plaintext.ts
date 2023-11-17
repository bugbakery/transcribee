import { Document } from '../../editor/types';
import { getSpeakerName } from '../document';

export function generatePlaintext(doc: Document, includeSpeakerNames: boolean): string {
  let last_speaker: string | null = null;
  return doc.children
    .map((paragraph) => {
      let paragraphText = '';
      if (includeSpeakerNames && last_speaker !== paragraph.speaker) {
        paragraphText += `${getSpeakerName(paragraph.speaker, doc.speaker_names)}:\n`;
        last_speaker = paragraph.speaker;
      }
      paragraphText += paragraph.children.map((x) => x.text).join('');
      return paragraphText.trim();
    })
    .filter((x) => x !== '')
    .join('\n\n');
}
