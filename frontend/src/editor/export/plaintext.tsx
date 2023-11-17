import { useState } from 'react';
import * as Automerge from '@automerge/automerge';

import { Checkbox } from '../../components/form';
import { downloadTextAsFile } from '../../utils/download_text_as_file';
import { ExportProps } from '.';
import { PrimaryButton, SecondaryButton } from '../../components/button';
import { generatePlaintext } from '../../utils/export/plaintext';

export function PlaintextExportBody({ onClose, outputNameBase, editor }: ExportProps) {
  const [includeSpeakerNames, setIncludeSpeakerNames] = useState(true);

  return (
    <form className="flex flex-col gap-4 mt-4">
      <Checkbox
        label="Include Speaker Names"
        value={includeSpeakerNames}
        onChange={(x) => setIncludeSpeakerNames(x)}
      />
      <div className="flex justify-between pt-4">
        <SecondaryButton type="button" onClick={onClose}>
          Cancel
        </SecondaryButton>
        <PrimaryButton
          type="submit"
          onClick={async (e) => {
            e.preventDefault();
            const plaintext = generatePlaintext(Automerge.toJS(editor.doc), includeSpeakerNames);
            downloadTextAsFile(`${outputNameBase}.txt`, `text/plain`, plaintext);
            onClose();
          }}
        >
          Export
        </PrimaryButton>
      </div>
    </form>
  );
}
