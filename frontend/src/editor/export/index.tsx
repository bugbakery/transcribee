import { ComponentProps, useState } from 'react';
import { Editor } from 'slate';

import { FormControl, Input, Select } from '../../components/form';
import { Modal } from '../../components/modal';
import { WebVttExportBody } from './webvtt';
import { TranscribeeExportBody } from './transcribee';
import { ApiDocument } from '../../api/document';
import { PlaintextExportBody } from './plaintext';

export type ExportProps = {
  outputNameBase: string;
  editor: Editor;
  onClose: () => void;
  document?: ApiDocument;
};

export type ExportType = {
  name: string;
  component: (props: ExportProps) => JSX.Element;
};

export type CanExportResult = {
  canGenerate: boolean;
  reason: string;
};

const exportTypes: ExportType[] = [
  {
    name: 'Subtitles',
    component: WebVttExportBody,
  },
  {
    name: 'Plaintext',
    component: PlaintextExportBody,
  },
  {
    name: 'Transcribee Archive',
    component: TranscribeeExportBody,
  },
];

export function ExportModal({
  onClose,
  editor,
  document,
  ...props
}: {
  onClose: () => void;
  editor: Editor;
  document?: ApiDocument;
} & Omit<ComponentProps<typeof Modal>, 'label'>) {
  const [exportType, setExportType] = useState(exportTypes[0]);
  const ExportBodyComponent = exportType.component;

  const [outputNameBase, setOutputNameBase] = useState(document?.name || 'document');

  return (
    <Modal {...props} onClose={onClose} label="Export as …">
      {exportTypes.length > 1 && (
        <Select
          value={exportTypes.indexOf(exportType)}
          onChange={(e) => {
            setExportType(exportTypes[parseInt(e.target.value)]);
          }}
        >
          {exportTypes.map((et, i) => (
            <option key={i} value={i}>
              {et.name}
            </option>
          ))}
        </Select>
      )}
      <FormControl label={'Name'} className="mt-2">
        <Input
          autoFocus
          value={outputNameBase}
          onChange={(e) => {
            setOutputNameBase(e.target.value);
          }}
        />
      </FormControl>
      <ExportBodyComponent
        outputNameBase={outputNameBase}
        editor={editor}
        onClose={onClose}
        document={document}
      />
    </Modal>
  );
}
