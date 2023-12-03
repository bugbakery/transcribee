import { useEffect, useState } from 'react';
import { AppCenter } from '../components/app';
import clsx from 'clsx';

export function LoadingPage() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    setTimeout(() => {
      setVisible(true);
    }, 200);
  }, []);

  return (
    <AppCenter>
      <div className={clsx(visible ? 'flex flex-col items-center gap-6' : 'hidden')}>
        <h1 className="font-medium text-4xl">Loading...</h1>
        <p>Transcribee is currently loading...</p>
      </div>
    </AppCenter>
  );
}
