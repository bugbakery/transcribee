import * as Automerge from '@automerge/automerge';
import { Editor } from 'slate';

import { downloadBinaryAsFile } from '../../utils/download_text_as_file';
import { ExportType, ExportProps } from './export_options';

function DebugExport({ onExportRef, setCanExport, outputNameBase }: ExportProps): JSX.Element {
  onExportRef.current = async (editor: Editor) => {
    const doc = Automerge.save(editor.doc);
    downloadBinaryAsFile(`${outputNameBase}.automerge`, `application/octet-stream`, doc);
  };
  setTimeout(() => setCanExport({ canGenerate: true, reason: '' }));
  return <></>;
}

export const debugExportType: ExportType = {
  type: 'Debug Export',
  component: DebugExport,
};
