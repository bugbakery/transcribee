import clsx from 'clsx';

import loadingBee from './loading_bee.svg';

export function LoadingBee({ className, size = 20 }: { className?: string; size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
      }}
      aria-label="Loading"
      role="status"
      className={clsx('animate-spin-slow flex flex-col items-center', className)}
    >
      <img src={loadingBee} className={clsx('w-full h-full flex-none', className)} />
    </div>
  );
}
