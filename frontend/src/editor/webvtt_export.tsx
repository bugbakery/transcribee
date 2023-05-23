import { ChangeEvent, useState } from 'react';
import * as Automerge from '@automerge/automerge';
import { AutomergeEditor } from 'slate-automerge-doc';

import { PrimaryButton, SecondaryButton } from '../components/button';
import { Checkbox, FormControl, Input, Select } from '../components/form';
import { Modal, ModalProps } from '../components/modal';
import { generateWebVtt } from '../utils/export/webvtt';
import { SubtitleFormat } from '@audapolis/webvtt-writer';
import { downloadTextAsFile } from '../utils/download_text_as_file';

export function WebvttExportModal({
  onClose,
  editor,
  ...props
}: {
  onClose: () => void;
  editor: AutomergeEditor;
} & Omit<ModalProps, 'label'>) {
  const [includeSpeakerNames, setIncludeSpeakerNames] = useState(true);
  const [includeWordTimings, setIncludeWordTimings] = useState(false);
  const [limitLineLength, setLimitLineLength] = useState(false);
  const [maxLineLength, setMaxLineLength] = useState(60);
  const [format, setFormat] = useState('vtt' as SubtitleFormat);

  return (
    <Modal {...props} onClose={onClose} label="Export as …">
      <form
        className="flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          onClose();
          const vtt = generateWebVtt(
            Automerge.toJS(editor.doc),
            includeSpeakerNames,
            includeWordTimings,
            maxLineLength,
          );
          downloadTextAsFile(`document.${format}`, `text/${format}`, vtt.toString(format));
        }}
      >
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
              checked={format == 'vtt' && includeSpeakerNames}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                setIncludeSpeakerNames(e.target.checked)
              }
            />
            <Checkbox
              label="Include Word-Timings"
              checked={format == 'vtt' && includeWordTimings}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                setIncludeWordTimings(e.target.checked)
              }
            />
          </>
        ) : (
          <></>
        )}
        <Checkbox
          label="Limit line length"
          checked={limitLineLength}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setLimitLineLength(e.target.checked)}
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
        <div className="flex justify-between">
          <SecondaryButton type="button" onClick={onClose}>
            Cancel
          </SecondaryButton>
          <PrimaryButton type="submit">Export</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}
