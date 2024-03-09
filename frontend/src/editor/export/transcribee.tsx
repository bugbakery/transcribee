import { useMemo, useState } from 'react';
import * as Automerge from '@automerge/automerge';

import { Checkbox } from '../../components/form';
import { downloadBinaryAsFile } from '../../utils/download_text_as_file';
import { ExportProps } from '.';
import { HttpReader, Uint8ArrayReader, ZipWriter, Uint8ArrayWriter } from '@zip.js/zip.js';
import { LoadingSpinnerButton, SecondaryButton } from '../../components/button';
import { splitAndSortMediaFiles } from '../player';

export function TranscribeeExportBody({ onClose, outputNameBase, editor, document }: ExportProps) {
  const [loading, setLoading] = useState(false);
  const [includeOriginalMediaFile, setIncludeOriginalMediaFile] = useState(false);

  const bestMediaUrl = useMemo(() => {
    const { videoSources, audioSources, hasVideo } = splitAndSortMediaFiles(
      document?.media_files || [],
    );
    const bestSource = hasVideo ? videoSources[0] : audioSources[0];
    return bestSource.src;
  }, [document?.media_files]);

  const originalMediaUrl = useMemo(() => {
    for (const media_file of document?.media_files || []) {
      if (media_file.tags.includes('original')) {
        return media_file.url;
      }
    }
  }, [document?.media_files]);

  return (
    <form className="flex flex-col gap-4 mt-4">
      <Checkbox
        label="Export original media file"
        value={includeOriginalMediaFile}
        onChange={(x) => setIncludeOriginalMediaFile(x)}
      />
      {includeOriginalMediaFile && (
        <div className="block bg-yellow-100 px-2 py-2 rounded text-center text-yellow-700">
          <strong>Warning:</strong> Exporting the original media file can lead to much larger
          archives as well as long loading times.
        </div>
      )}
      <div className="flex justify-between pt-4">
        <SecondaryButton type="button" onClick={onClose}>
          Cancel
        </SecondaryButton>
        <LoadingSpinnerButton
          type="submit"
          onClick={async (e) => {
            e.preventDefault();
            setLoading(true);
            try {
              const mediaUrl =
                includeOriginalMediaFile && originalMediaUrl ? originalMediaUrl : bestMediaUrl;
              const zipFileWriter = new Uint8ArrayWriter();
              const zipWriter = new ZipWriter(zipFileWriter, { level: 0 });
              const doc = new Uint8ArrayReader(Automerge.save(editor.doc));
              await Promise.all([
                zipWriter.add('document.automerge', doc),
                zipWriter.add('media', new HttpReader(mediaUrl, { preventHeadRequest: true })),
              ]);

              await zipWriter.close();
              const zipFileBlob = await zipFileWriter.getData();
              downloadBinaryAsFile(
                `${outputNameBase}.transcribee`,
                `application/octet-stream`,
                zipFileBlob,
              );

              onClose();
            } catch (e) {
              console.error('Error while exporting', e);
            }
            setLoading(false);
          }}
          variant="primary"
          loading={loading}
        >
          Export
        </LoadingSpinnerButton>
      </div>
    </form>
  );
}
