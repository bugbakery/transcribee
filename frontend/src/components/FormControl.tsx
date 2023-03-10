import { ReactNode } from 'react';

export type FormControlProps = {
  label: string;
  error?: string;
  children: ReactNode;
};

export default function FormControl({ label, error, children }: FormControlProps) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {error && <p className="text-red-600 text-sm mt-1">{error}</p>}
    </label>
  );
}
