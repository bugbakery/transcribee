import clsx from 'clsx';

export function LoadingSpinner({ className }: { className?: string }) {
  return (
    <div
      aria-label="Loading"
      role="status"
      className={clsx(
        'animate-spin',
        'rounded-full',
        'border-2 border-transparent border-b-black dark:border-b-white',
        'h-6 w-6',
        className,
      )}
    />
  );
}
