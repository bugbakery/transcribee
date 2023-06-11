import { MutableRefObject } from 'react';

import { Editor } from 'slate';

export type CanExportResult = {
  canGenerate: boolean;
  reason: string;
};

export type ExportProps = {
  onExportRef: MutableRefObject<(editor: Editor) => Promise<void>>;
  setCanExport: (_c: CanExportResult) => void;
  outputNameBase: string;
  editor: Editor;
};

export type ExportType = {
  type: string;
  // We pass a ref as onExport/canExport which the type specific export component will set to its implementation of the function
  component: (props: ExportProps) => JSX.Element;
};
