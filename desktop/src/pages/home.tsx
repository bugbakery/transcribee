import { PrimaryButton, SecondaryButton } from 'transcribee-ui-common/components/button';
import { invoke } from '@tauri-apps/api/core';
import { useTauriState } from '../util/use_tauri_event';

type MediaFile = {
  content_type: string;
  tags: string[];
  url: string;
};
export type Document = {
  id: string;
  display_name: string;
  transcription_progress: number;
  save_path?: string;
  media_files: MediaFile[];
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
            invoke('show_new_transcript_dialog');
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
