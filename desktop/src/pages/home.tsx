import { PrimaryButton, SecondaryButton } from 'transcribee-ui-common/components/button';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { useTauriState } from '../util/use_tauri_event';

export type Document = {
  id: string;
  display_name: string;
  transcription_progress: number;
};

export function HomePage() {
  const documents = useTauriState<Document[]>(
    async () => await invoke('get_documents'),
    'documents_changed',
    [],
  );

  return (
    <div className="flex flex-col w-full h-full items-center justify-center gap-4">
      <div className="flex flex-row w-full items-center justify-center gap-4">
        <PrimaryButton
          className="block w-60"
          onClick={async () => {
            const file = await open({
              multiple: false,
              directory: false,
              filters: [
                { name: 'Audio Files', extensions: ['mp3', 'acc', 'm4a', 'ogg', 'wav'] },
                {
                  name: 'Video Files',
                  extensions: ['mkv', 'mp4', 'mov', 'avi', 'wmv', 'flv', 'webm'],
                },
              ],
            });
            invoke('transcribe_file', { mediaFilePath: file });
          }}
        >
          Transcribe Audio
        </PrimaryButton>
        <SecondaryButton
          className="block w-60"
          onClick={async () => {
            await invoke('open_document_via_file_picker');
          }}
        >
          Open Transcribed File
        </SecondaryButton>
      </div>
      <div>
        <div>Recent Documents:</div>
        <table>
          <tbody>
            {documents.map((doc) => (
              <tr key={doc.id} className="border-separate border-spacing-2 border border-gray-400">
                <td
                  className="p-2"
                  title={doc.id}
                  onClick={async () => {
                    await invoke('open_document_window', { id: doc.id });
                  }}
                >
                  {doc.display_name}
                </td>
                <td className="p-2">{doc.transcription_progress}</td>
                <td
                  className="p-2"
                  onClick={() => {
                    invoke('forget_document', { id: doc.id });
                  }}
                >
                  X
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
