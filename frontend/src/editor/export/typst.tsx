import * as Automerge from '@automerge/automerge';

import { downloadTextAsFile } from '../../utils/download_text_as_file';
import { ExportProps } from '.';
import { PrimaryButton, SecondaryButton } from '../../components/button';
import { Document } from '../../editor/types';
import { formattedTime } from '../transcription_editor';

export function generateTypst(doc: Document): string {
  let last_speaker: string | null = null;
  const header = `
#let p(time: none, speaker: none, speaker_change: false, body) = {
  box(context {
    if speaker_change [
      #v(1em)
      *#speaker:* \
    ]
    let sizeTime = measure(time)
    place(dx: -sizeTime.width - 1em, text(fill: gray, time))
    body
  })
}\n\n`;

  return (
    header +
    doc.children
      .map((paragraph) => {
        const timeStr = `time: "${formattedTime(paragraph.children[0].start)}"`;
        const speakerStr = `speaker: "${
          paragraph.speaker && doc.speaker_names[paragraph.speaker]
        }"`;
        const speakerChangeStr = `speaker_change: ${last_speaker !== paragraph.speaker}`;
        let paragraphText = `#p(${timeStr}, ${speakerStr}, ${speakerChangeStr})[\n`;

        function escape(text: string): string {
          return text
            .replace(/\]/g, '\\]')
            .replace(/\[/g, '\\[')
            .replace(/\*/g, '\\*')
            .replace(/_/g, '\\_');
        }

        paragraphText += paragraph.children
          .map((x) => escape(x.text))
          .join('')
          .trim();

        paragraphText += '\n]\n';
        if (last_speaker !== paragraph.speaker) {
          paragraphText += '\n';
        }

        last_speaker = paragraph.speaker;
        return paragraphText;
      })
      .filter((x) => x !== '')
      .join('\n')
  );
}

export function TypstExportBody({ onClose, outputNameBase, editor }: ExportProps) {
  return (
    <form className="flex flex-col gap-4 mt-4">
      <div className="flex justify-between pt-4">
        <SecondaryButton type="button" onClick={onClose}>
          Cancel
        </SecondaryButton>
        <PrimaryButton
          type="submit"
          onClick={async (e) => {
            e.preventDefault();
            const plaintext = generateTypst(Automerge.toJS(editor.doc));
            downloadTextAsFile(`${outputNameBase}.typ`, `text/plain`, plaintext);
            onClose();
          }}
        >
          Export
        </PrimaryButton>
      </div>
    </form>
  );
}
