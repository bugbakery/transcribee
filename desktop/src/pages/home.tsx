import { PrimaryButton, SecondaryButton } from 'transcribee-ui-common/components/button';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { useLocation } from 'wouter';

export function HomePage() {
  const [_, navigate] = useLocation();

  return (
    <div className="flex flex-col w-full h-full items-center justify-center gap-4">
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
          invoke('transcribe_file', { filePath: file });
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
  );
}
