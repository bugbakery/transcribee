import { navigate } from 'wouter/use-location';

import PrimaryButton from '../components/PrimaryButton';

export default function HomePage() {
  return (
    <div className="container mx-auto py-6">
      <PrimaryButton onClick={() => navigate('/login')}>Login</PrimaryButton>{' '}
      <PrimaryButton onClick={() => navigate('/new')}>New Document</PrimaryButton>
    </div>
  );
}
