import { ComponentProps, ReactNode } from 'react';
import { primitiveWithClassname } from '../styled';
import clsx from 'clsx';

export type FormControlProps = {
  label: string;
  error?: string;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
};

export function FormControl({ label, error, disabled, children, className }: FormControlProps) {
  return (
    <label className={clsx('block', className)}>
      <span
        className={clsx(
          'text-sm font-medium',
          disabled ? 'text-slate-400 dark:text-neutral-500' : '',
        )}
      >
        {label}
      </span>
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
  'disabled:border-slate-400 disabled:dark:border-neutral-500 disabled:text-slate-400 disabled:dark:text-neutral-500',
]);

export function Checkbox({
  label,
  disabled,
  inputClassName = '',
  onChange,
  value,
  ...props
}: {
  label: string;
  disabled?: boolean;
  inputClassName?: string;
  onChange: (newValue: boolean) => void;
  value: boolean;
} & Omit<ComponentProps<'label'>, 'onChange'>): JSX.Element {
  return (
    <label
      {...props}
      className={clsx(
        'w-full flex items-center text-start',
        disabled ? 'text-slate-500 dark:text-neutral-400' : '',
        props.className,
      )}
    >
      <input
        type="checkbox"
        className={clsx(
          'form-input',
          'rounded',
          'border-2',
          'border-black dark:border-neutral-200',
          'mr-3',
          'p-2',
          'dark:bg-neutral-900',
          'dark:focus:ring-blue-400 dark:focus:border-blue-400',
          'disabled:border-slate-500 disabled:dark:border-neutral-400',
          inputClassName,
        )}
        disabled={disabled}
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

export const Select = primitiveWithClassname('select', [
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
