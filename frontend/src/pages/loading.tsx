import { AppCenter } from '../components/app';

export function LoadingPage() {
  return (
    <AppCenter>
      <div className="flex flex-col items-center gap-6">
        <h1 className="font-medium text-4xl">Loading...</h1>
        <p>Transcribee is currently loading...</p>
      </div>
    </AppCenter>
  );
}
