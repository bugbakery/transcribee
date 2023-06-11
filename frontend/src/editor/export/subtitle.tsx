import { useState } from 'react';
import * as Automerge from '@automerge/automerge';
import { Editor } from 'slate';

import { Checkbox, FormControl, Input, Select } from '../../components/form';
import { generateWebVtt, canGenerateVtt } from '../../utils/export/webvtt';
import { SubtitleFormat } from '@audapolis/webvtt-writer';
import { downloadTextAsFile } from '../../utils/download_text_as_file';
import { ExportType, ExportProps } from './export_options';

function SubtitleExport({
  onExportRef,
  setCanExport,
  outputNameBase,
  editor,
}: ExportProps): JSX.Element {
  const [includeSpeakerNames, setIncludeSpeakerNames] = useState(true);
  const [includeWordTimings, setIncludeWordTimings] = useState(false);
  const [limitLineLength, setLimitLineLength] = useState(false);
  const [maxLineLength, setMaxLineLength] = useState(60);
  const [format, setFormat] = useState('vtt' as SubtitleFormat);

  onExportRef.current = async (editor: Editor) => {
    const vtt = generateWebVtt(
      Automerge.toJS(editor.doc),
      includeSpeakerNames,
      includeWordTimings,
      maxLineLength,
    );
    downloadTextAsFile(`${outputNameBase}.${format}`, `text/${format}`, vtt.toString(format));
  };
  setTimeout(() => setCanExport(canGenerateVtt(editor.doc.children)));
  return (
    <>
      <Select
        value={format}
        onChange={(e) => {
          if (e.target.value === 'srt' || e.target.value === 'vtt') {
            setFormat(e.target.value);
          }
        }}
      >
        <option value="vtt">WebVTT</option>
        <option value="srt">SRT</option>
      </Select>
      {format == 'vtt' ? (
        <>
          <Checkbox
            label="Include Speaker Names"
            value={format == 'vtt' && includeSpeakerNames}
            onChange={setIncludeSpeakerNames}
          />
          <Checkbox
            label="Include Word-Timings"
            value={format == 'vtt' && includeWordTimings}
            onChange={setIncludeWordTimings}
          />
        </>
      ) : (
        <></>
      )}
      <Checkbox label="Limit line length" value={limitLineLength} onChange={setLimitLineLength} />
      <FormControl label={'Line length limit (in characters)'} disabled={!limitLineLength}>
        <Input
          autoFocus
          value={maxLineLength}
          type="number"
          onChange={(e) => {
            setMaxLineLength(parseInt(e.target.value));
          }}
          disabled={!limitLineLength}
        />
      </FormControl>
    </>
  );
}

export const subtitleExportType: ExportType = {
  type: 'Subtitle',
  component: SubtitleExport,
};
