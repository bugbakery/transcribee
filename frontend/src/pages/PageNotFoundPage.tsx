import { navigate } from 'wouter/use-location';

import PrimaryButton from '../components/PrimaryButton';

export default function PageNotFoundPage() {
  return (
    <div className="h-screen flex items-center justify-center">
      <div className="flex flex-col items-center gap-6">
        <h1 className="font-medium text-4xl">Page Not Found</h1>
        <p>We couldn&apos;t find what you were looking for.</p>
        <PrimaryButton onClick={() => navigate('/')}>Go to Home</PrimaryButton>
      </div>
    </div>
  );
}
