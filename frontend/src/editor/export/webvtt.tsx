import { useMemo, useState } from 'react';
import * as Automerge from '@automerge/automerge';

import { Checkbox, FormControl, Input, Select } from '../../components/form';
import { canGenerateVtt, generateWebVtt } from '../../utils/export/webvtt';
import { SubtitleFormat } from '@audapolis/webvtt-writer';
import { downloadTextAsFile } from '../../utils/download_text_as_file';
import { pushToPodlove } from '../../utils/export_to_podlove';
import { ExportProps } from '.';
import { PrimaryButton, SecondaryButton, IconButton } from '../../components/button';
import { BsEye, BsEyeSlash } from 'react-icons/bs';

export function WebVttExportBody({ onClose, outputNameBase, editor }: ExportProps) {
  const [includeSpeakerNames, setIncludeSpeakerNames] = useState(true);
  const [includeWordTimings, setIncludeWordTimings] = useState(false);
  const [limitLineLength, setLimitLineLength] = useState(false);
  const [maxLineLength, setMaxLineLength] = useState(60);
  const [podloveEpisodeId, setPodloveEpisodeId] = useState(1);
  const [podloveUser, setPodloveUser] = useState('');
  const [podloveShowApplicationId, setPodloveShowApplicationId] = useState(false);
  const [podloveApplicationId, setPodloveId] = useState('');
  const [podloveUrl, setPodloveUrl] = useState('');
  const [format, setFormat] = useState('vtt' as SubtitleFormat);
  const canExport = useMemo(() => canGenerateVtt(editor.doc.children), [editor.v]);

  return (
    <form className="flex flex-col gap-4 pt-2">
      <FormControl label="Format">
        <Select
          value={format}
          onChange={(e) => {
            if (e.target.value === 'srt' || e.target.value === 'vtt' || e.target.value === 'podlove') {
              setFormat(e.target.value);
            }
          }}
        >
          <option value="vtt">WebVTT</option>
          <option value="srt">SRT</option>
          <option value="podlove">Podlove</option>
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
      {format == 'podlove' ? (
        <>
          <Checkbox
            label="Include Speaker Names"
            value={format == 'podlove' && includeSpeakerNames}
            onChange={(x) => setIncludeSpeakerNames(x)}
          />
          <FormControl label={'Episode (id)'}>
            <Input
              autoFocus
              value={podloveEpisodeId}
              type="number"
              onChange={(e) => {
                setPodloveEpisodeId(parseInt(e.target.value));
              }}
            />
          </FormControl>
          <FormControl label={'User'}>
            <Input
              autoFocus
              value={podloveUser}
              type="string"
              onChange={(e) => {
                setPodloveUser(e.target.value);
              }}
            />
          </FormControl>
          <FormControl label={'Application Password'}>
            <div className="mb-4 flex">
              <Input
                autoFocus
                value={podloveApplicationId}
                type={
                  podloveShowApplicationId ? "text" : "password"
                }
                onChange={(e) => {
                  setPodloveId(e.target.value);
                }}
              />
              <IconButton
                icon={podloveShowApplicationId ? BsEyeSlash : BsEye }
                size={20}
                onClick={(e) => {
                    e.preventDefault();
                    setPodloveShowApplicationId(!podloveShowApplicationId);
                  }
                }
                label="Show / Hide"
                iconClassName="inline-block -mt-1"
                className="rounded-xl px-4 py-1"
                iconAfter={true}
              >
              </IconButton>
            </div>
          </FormControl>
          <FormControl label={'Podlove Publisher baseUrl'}>
            <Input
              autoFocus
              value={podloveUrl}
              type="string"
              onChange={(e) => {
                setPodloveUrl(e.target.value);
              }}
            />
          </FormControl>

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
            if (format === 'vtt' || format === 'srt') {
              downloadTextAsFile(
                `${outputNameBase}.${format}`,
                `text/${format}`,
                vtt.toString(format),
              );
            }
            else {
              pushToPodlove(podloveEpisodeId, podloveUser, podloveApplicationId, podloveUrl, vtt.toString('vtt'));
            }
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
