import {
  ComponentProps,
  ReactNode,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
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
    <label className={clsx('block', 'relative', className)}>
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

export const Slider = forwardRef<HTMLInputElement>(
  ({ ...props }: Omit<ComponentProps<'input'>, 'type'>, ref) => {
    const innerRef = useRef<HTMLInputElement>(null as unknown as HTMLInputElement);
    useImperativeHandle(ref, () => innerRef.current);

    const listener = useCallback(() => {
      if (!innerRef.current) {
        return;
      }
      const percent =
        ((parseFloat(innerRef.current.value) - parseFloat(innerRef.current.min)) /
          (parseFloat(innerRef.current.max) - parseFloat(innerRef.current.min))) *
        100;
      innerRef.current?.style.setProperty('--progress', `${percent}%`);
    }, []);

    useEffect(() => {
      const current = innerRef.current;
      if (!current) {
        return;
      }

      current.addEventListener('input', listener);
      listener();

      return () => {
        current.removeEventListener('input', listener);
      };
    }, []);

    return (
      <input
        type="range"
        className={clsx(
          'appearance-none',

          'w-full',
          'h-1',
          'rounded-full',

          'bg-neutral-400',
          'bg-[linear-gradient(to_right,rgba(0,0,0,0.8),rgba(0,0,0,0.8)_var(--progress),transparent_var(--progress))]',
          'dark:bg-[linear-gradient(to_right,white,white_var(--progress),transparent_var(--progress))]',

          '[&::-moz-range-track]:rounded-full',

          '[&::-moz-range-thumb]:appearance-none',
          '[&::-mox-range-thumb]:box-content', // box-border does not seem to work in firefox
          '[&::-moz-range-thumb]:h-3',
          '[&::-moz-range-thumb]:w-3',
          '[&::-moz-range-thumb]:bg-white',
          'dark:[&::-moz-range-thumb]:bg-black',
          '[&::-moz-range-thumb]:rounded-full',
          '[&::-moz-range-thumb]:border-black',
          'dark:[&::-moz-range-thumb]:border-white',
          '[&::-moz-range-thumb]:border-2',

          '[&::-webkit-slider-thumb]:appearance-none',
          '[&::-webkit-slider-thumb]:box-content', // box-border does not seem to work in firefox
          '[&::-webkit-slider-thumb]:h-3',
          '[&::-webkit-slider-thumb]:w-3',
          '[&::-webkit-slider-thumb]:bg-white',
          'dark:[&::-webkit-slider-thumb]:bg-black',
          '[&::-webkit-slider-thumb]:rounded-full',
          '[&::-webkit-slider-thumb]:border-black',
          'dark:[&::-webkit-slider-thumb]:border-white',
          '[&::-webkit-slider-thumb]:border-2',
          '[&::-webkit-slider-thumb]:border-solid',
        )}
        ref={innerRef}
        {...props}
      />
    );
  },
);
Slider.displayName = 'slider';
