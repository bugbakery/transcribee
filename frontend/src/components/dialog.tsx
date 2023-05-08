import { primitiveWithClassname } from '../styled';

export const Dialog = primitiveWithClassname('div', [
  'w-96',
  'p-6',
  'bg-white dark:bg-neutral-900',
  'border-black dark:border-neutral-200',
  'border-2',
  'shadow-brutal',
  'shadow-slate-400 dark:shadow-neutral-600',
  'rounded-lg',
]);

export const DialogTitle = primitiveWithClassname('h2', 'font-bold text-lg mb-4');
