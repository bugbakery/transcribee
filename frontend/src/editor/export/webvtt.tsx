import { useMemo, useState } from 'react';
import * as Automerge from '@automerge/automerge';

import { Checkbox, FormControl, Input, Select } from '../../components/form';
import { canGenerateVtt, generateWebVtt } from '../../utils/export/webvtt';
import { SubtitleFormat } from '@audapolis/webvtt-writer';
import { downloadTextAsFile } from '../../utils/download_text_as_file';
import { ExportProps } from '.';
import { PrimaryButton, SecondaryButton } from '../../components/button';

export function WebVttExportBody({ onClose, outputNameBase, editor }: ExportProps) {
  const [includeSpeakerNames, setIncludeSpeakerNames] = useState(true);
  const [includeWordTimings, setIncludeWordTimings] = useState(false);
  const [limitLineLength, setLimitLineLength] = useState(false);
  const [maxLineLength, setMaxLineLength] = useState(60);
  const [format, setFormat] = useState('vtt' as SubtitleFormat);
  const canExport = useMemo(() => canGenerateVtt(editor.doc.children), [editor.v]);

  return (
    <form className="flex flex-col gap-4 pt-2">
      <FormControl label="Format">
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
      </FormControl>
      {format == 'vtt' ? (
        <>
          <Checkbox
            label="Include Speaker Names"
            value={format == 'vtt' && includeSpeakerNames}
            onChange={(x) => setIncludeSpeakerNames(x)}
          />
          <Checkbox
            label="Include Word-Timings"
            value={format == 'vtt' && includeWordTimings}
            onChange={(x) => setIncludeWordTimings(x)}
          />
        </>
      ) : (
        <></>
      )}
      <Checkbox
        label="Limit line length"
        value={limitLineLength}
        onChange={(x) => setLimitLineLength(x)}
      />
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
      {!canExport.canGenerate && canExport.reason && (
        <div className="block bg-red-100 px-2 py-2 rounded text-center text-red-700">
          {canExport.reason}
        </div>
      )}
      <div className="flex justify-between">
        <SecondaryButton type="button" onClick={onClose}>
          Cancel
        </SecondaryButton>
        <PrimaryButton
          type="submit"
          onClick={(e) => {
            e.preventDefault();
            const vtt = generateWebVtt(
              Automerge.toJS(editor.doc),
              includeSpeakerNames,
              includeWordTimings,
              maxLineLength,
            );
            downloadTextAsFile(
              `${outputNameBase}.${format}`,
              `text/${format}`,
              vtt.toString(format),
            );
            onClose();
          }}
          disabled={!canExport.canGenerate}
        >
          Export
        </PrimaryButton>
      </div>
    </form>
  );
}
