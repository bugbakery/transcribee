import { PrimaryButton, SecondaryButton } from 'transcribee-ui-common/components/button';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { useLocation } from 'wouter';
import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';

type Document = {
  path: string;
  display_name: string;
  transcription_progress: number;
};

export function HomePage() {
  const [_, navigate] = useLocation();
  const [documents, setDocuments] = useState<Document[]>([]);
  useEffect(() => {
    let unlisten = () => {};
    (async () => {
      const documents: Document[] = await invoke('list_documents');
      setDocuments(documents);
      unlisten = await listen<Document[]>('documents-changed', (e) => {
        console.log(e);
        setDocuments(e.payload);
      });
    })();
    return unlisten;
  }, []);

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
            const file = await open({
              multiple: false,
              directory: false,
              filters: [
                {
                  name: 'Transcribee Archive',
                  extensions: ['transcribee'],
                },
              ],
            });
            navigate(`document/${file}`);
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
              <tr
                key={doc.path}
                className="border-separate border-spacing-2 border border-gray-400"
              >
                <td
                  className="p-2"
                  title={doc.path}
                  onClick={() => {
                    navigate(`document/${doc.path}`);
                  }}
                >
                  {doc.display_name}
                </td>
                <td className="p-2">{doc.transcription_progress}</td>
                <td
                  className="p-2"
                  onClick={() => {
                    invoke('forget_document', { path: doc.path });
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
