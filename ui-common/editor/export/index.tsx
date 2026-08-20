import { ComponentProps, JSX, useState } from 'react';
import { Editor } from 'slate';

import { FormControl, Input, Select } from '../../components/form';
import { Modal } from '../../components/modal';
import { WebVttExportBody } from './webvtt';
import { TranscribeeExportBody } from './transcribee';
import { PlaintextExportBody } from './plaintext';
import { ApiDocument } from '../api_document';

export type ExportProps = {
  outputNameBase: string;
  editor: Editor;
  onClose: () => void;
  document?: ApiDocument;
  downloadFn: (fileName: string, mimeType: string, data: Uint8Array<ArrayBuffer> | string) => void;
};

export type ExportType = {
  name: string;
  component: (props: ExportProps) => JSX.Element;
  needsDocument: boolean;
};

export type CanExportResult = {
  canGenerate: boolean;
  reason: string;
};

const exportTypes: ExportType[] = [
  {
    name: 'Subtitles',
    component: WebVttExportBody,
    needsDocument: false,
  },
  {
    name: 'Plaintext',
    component: PlaintextExportBody,
    needsDocument: false,
  },
  {
    name: 'Transcribee Archive',
    component: TranscribeeExportBody,
    needsDocument: true,
  },
];

export function ExportModal({
  onClose,
  editor,
  document,
  downloadFn,
  ...props
}: {
  onClose: () => void;
  editor: Editor;
  document?: ApiDocument;
  downloadFn: (fileName: string, mimeType: string, data: Uint8Array<ArrayBuffer> | string) => void;
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
          {exportTypes
            .filter((x) => !x.needsDocument || document)
            .map((et, i) => (
              <option key={i} value={i}>
                {et.name}
              </option>
            ))}
        </Select>
      )}

      {
        // if document is not supplied, we run on desktop. There we dont display the name control as
        // we display a file chooser afterwards.
        document && (
          <FormControl label={'Name'} className="mt-2">
            <Input
              autoFocus
              value={outputNameBase}
              onChange={(e) => {
                setOutputNameBase(e.target.value);
              }}
            />
          </FormControl>
        )
      }
      <ExportBodyComponent
        outputNameBase={outputNameBase}
        editor={editor}
        onClose={onClose}
        document={document}
        downloadFn={downloadFn}
      />
    </Modal>
  );
}
