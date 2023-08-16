import clsx from 'clsx';

export function LoadingSpinner({
  className,
  size = 20,
}: {
  className?: string;
  size?: number | string;
}) {
  return (
    <div
      style={{
        width: size,
        height: size,
      }}
      aria-label="Loading"
      role="status"
      className={clsx(
        'animate-spin',
        'rounded-full',
        'border-2 border-transparent border-b-black dark:border-b-white',
        className,
      )}
    />
  );
}

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
      <img src="/favicon.svg" className={clsx('w-1/3 h-1/3 flex-none', className)} />
    </div>
  );
}
