import { useEffect, useMemo, useState } from 'react';
// import * as Automerge from '@automerge/automerge';

import { Checkbox, FormControl, Input, Select } from '../../components/form';
import { canGenerateVtt, generateWebVtt } from '../../utils/export/webvtt';
import { SubtitleFormat } from '@audapolis/webvtt-writer';
import { downloadTextAsFile } from '../../utils/download_text_as_file';
import { pushToPodlove, checkIsPodloveExportPossible } from '../../utils/export_to_podlove';
import { ExportProps } from '.';
import { PrimaryButton, SecondaryButton, IconButton } from '../../components/button';
import { BsEye, BsEyeSlash } from 'react-icons/bs';
import { documentToJSON } from '../../document';

type ExportFormat = SubtitleFormat | 'podlove';

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
  const [podloveExportPossible, setPodloveExportPossible] = useState(false);
  useEffect(() => {
    checkIsPodloveExportPossible(
      podloveEpisodeId,
      podloveUser,
      podloveApplicationId,
      podloveUrl,
    ).then(setPodloveExportPossible);
  }, [podloveEpisodeId, podloveUser, podloveApplicationId, podloveApplicationId, podloveUrl]);

  const [format, setFormat] = useState('vtt' as ExportFormat);
  const canExport = useMemo(() => canGenerateVtt(editor.docProxy.children), [editor.v]);

  return (
    <form className="flex flex-col gap-4 pt-2">
      <FormControl label="Format">
        <Select
          value={format}
          onChange={(e) => {
            if (
              e.target.value === 'srt' ||
              e.target.value === 'vtt' ||
              e.target.value === 'podlove'
            ) {
              setFormat(e.target.value);
            }
          }}
        >
          <option value="vtt">WebVTT</option>
          <option value="srt">SRT</option>
          <option value="podlove">Upload to Podlove Publisher</option>
        </Select>
      </FormControl>
      {format == 'podlove' ? (
        <>
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
            <div className="flex">
              <Input
                autoFocus
                value={podloveApplicationId}
                type={podloveShowApplicationId ? 'text' : 'password'}
                onChange={(e) => {
                  setPodloveId(e.target.value);
                }}
              />
              <IconButton
                icon={podloveShowApplicationId ? BsEyeSlash : BsEye}
                size={20}
                onClick={(e) => {
                  e.preventDefault();
                  setPodloveShowApplicationId(!podloveShowApplicationId);
                }}
                label={podloveShowApplicationId ? 'Hide' : 'Show'}
                iconClassName="inline-block -mt-1"
                className="rounded-xl px-4 py-1"
                iconAfter={true}
              ></IconButton>
            </div>
          </FormControl>
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
        </>
      ) : (
        <></>
      )}
      {format == 'vtt' || format == 'podlove' ? (
        <Checkbox
          label="Include Speaker Names"
          value={(format == 'vtt' || format == 'podlove') && includeSpeakerNames}
          onChange={(x) => setIncludeSpeakerNames(x)}
        />
      ) : (
        <></>
      )}
      {format == 'vtt' ? (
        <Checkbox
          label="Include Word-Timings"
          value={format == 'vtt' && includeWordTimings}
          onChange={(x) => {
            setIncludeWordTimings(x);
          }}
        />
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
      {((!canExport.canGenerate && canExport.reason) ||
        (format === 'podlove' && !podloveExportPossible)) && (
        <div className="block bg-red-100 px-2 py-2 rounded text-center text-red-700">
          <p>{canExport.reason}</p>
          {format === 'podlove' && !podloveExportPossible && (
            <p>
              Configured episode could not be found in the podlove publisher instance. Please check
              that the publisher url, credentials and episode id are correct.
            </p>
          )}
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
              documentToJSON(editor.doc),
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
            } else {
              pushToPodlove(
                podloveEpisodeId,
                podloveUser,
                podloveApplicationId,
                podloveUrl,
                vtt.toString('vtt'),
              );
            }
            onClose();
          }}
          disabled={!canExport.canGenerate || (!podloveExportPossible && format == 'podlove')}
        >
          Export
        </PrimaryButton>
      </div>
    </form>
  );
}
