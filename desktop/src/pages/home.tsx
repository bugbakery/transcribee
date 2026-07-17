import { PrimaryButton, SecondaryButton } from 'transcribee-ui-common/components/button';
import { open } from '@tauri-apps/plugin-dialog';
import { useLocation } from 'wouter';

export function HomePage() {
  const [_, navigate] = useLocation();

  return (
    <div className="flex flex-col w-full h-full items-center justify-center gap-4">
      <PrimaryButton className="block w-60">Transcribe Audio</PrimaryButton>
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
