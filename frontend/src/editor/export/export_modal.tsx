import { useState, useRef, ComponentProps } from 'react';
import { Editor } from 'slate';

import { PrimaryButton, SecondaryButton } from '../../components/button';
import { FormControl, Input, Select } from '../../components/form';
import { Modal } from '../../components/modal';
import { CanExportResult, ExportType } from './export_options';
import { subtitleExportType } from './subtitle';
import { debugExportType } from './debug';
import { useDebugMode } from '../../utils/use_debug_mode';
export function ExportModal({
  onClose,
  editor,
  outputBaseName,
  ...props
}: {
  onClose: () => void;
  editor: Editor;
  outputBaseName?: string;
} & Omit<ComponentProps<typeof Modal>, 'label'>) {
  const debugMode = useDebugMode();

  const exportTypes: ExportType[] = debugMode
    ? [subtitleExportType, debugExportType]
    : [subtitleExportType];

  const [outputNameBase, setOutputNameBase] = useState(outputBaseName || 'document');
  const [exportMode, setExportMode] = useState(exportTypes[0]);
  const [canExport, setCanExportInternal] = useState({
    canGenerate: false,
    reason: 'Export format did not overwrite canExportRef.',
  });
  const onExportRef = useRef((_editor: Editor) => {
    return new Promise<void>((resolve, _) => {
      resolve();
    });
  });

  const setCanExport = (v: CanExportResult) => {
    if (JSON.stringify(v) !== JSON.stringify(canExport)) setCanExportInternal(v);
  };

  const ExportComponent = exportMode.component;

  return (
    <Modal {...props} onClose={onClose} label="Export as …">
      <form
        className="flex flex-col gap-6"
        onSubmit={async (e) => {
          e.preventDefault();
          await onExportRef.current(editor);
          onClose();
        }}
      >
        {exportTypes.length > 1 && (
          <Select
            value={exportTypes.indexOf(exportMode)}
            onChange={(e) => {
              setExportMode(exportTypes[parseInt(e.target.value)]);
            }}
          >
            {exportTypes.map((et, i) => (
              <option key={i} value={i}>
                {et.type}
              </option>
            ))}
          </Select>
        )}
        <FormControl label={'Name'}>
          <Input
            autoFocus
            value={outputNameBase}
            onChange={(e) => {
              setOutputNameBase(e.target.value);
            }}
          />
        </FormControl>
        <ExportComponent
          onExportRef={onExportRef}
          setCanExport={setCanExport}
          outputNameBase={outputNameBase}
          editor={editor}
        />
        {!canExport.canGenerate && (
          <div className="block bg-red-100 px-2 py-2 rounded text-center text-red-700">
            {canExport.reason}
          </div>
        )}
        <div className="flex justify-between">
          <SecondaryButton type="button" onClick={onClose}>
            Cancel
          </SecondaryButton>
          <PrimaryButton type="submit" disabled={!canExport.canGenerate}>
            Export
          </PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}
