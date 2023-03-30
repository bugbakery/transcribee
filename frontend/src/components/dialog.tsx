import { primitiveWithClassname } from '../styled';

export const Dialog = primitiveWithClassname('div', [
  'w-96',
  'p-6',
  'bg-white',
  'border-black',
  'border-2',
  'shadow-brutal',
  'rounded-lg',
]);

export const DialogTitle = primitiveWithClassname('h2', 'font-bold text-lg mb-4');
