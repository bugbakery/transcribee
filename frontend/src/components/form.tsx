import { ReactNode } from 'react';
import { primitiveWithClassname } from '../styled';

export type FormControlProps = {
  label: string;
  error?: string;
  children: ReactNode;
};

export function FormControl({ label, error, children }: FormControlProps) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {error && <p className="text-red-600 text-sm mt-1">{error}</p>}
    </label>
  );
}

export const Input = primitiveWithClassname('input', [
  'block',
  'w-full',
  'form-input',
  'rounded',
  'border-2',
  'border-black dark:border-neutral-200',
  'mt-0.5',
  'dark:bg-neutral-900',
  'dark:focus:ring-blue-400 dark:focus:border-blue-400',
]);
