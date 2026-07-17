import { PrimaryButton, SecondaryButton } from 'transcribee-ui-common/components/button';

export function HomePage() {
  return (
    <div className="flex flex-col w-full h-full items-center justify-center gap-4">
      <PrimaryButton className="block w-60">Transcribe Audio</PrimaryButton>
      <SecondaryButton className="block w-60">Open Transcribed File</SecondaryButton>
    </div>
  );
}
