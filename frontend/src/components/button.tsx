import { primitiveWithClassname } from '../styled';
import { IconType } from 'react-icons';
import clsx from 'clsx';
import { ComponentProps } from 'react';
import { LoadingSpinner } from './loading_spinner';

export const PrimaryButton = primitiveWithClassname('button', [
  'bg-black dark:bg-neutral-200',
  'enabled:hover:bg-gray-700 dark:enabled:hover:bg-neutral-300',
  'disabled:bg-gray-200 dark:disabled:bg-neutral-800',
  'text-white dark:text-black',
  'disabled:text-gray-400 disabled:dark:text-gray-500',
  'rounded-md',
  'py-2 px-4',
]);

export const SecondaryButton = primitiveWithClassname('button', [
  'hover:bg-gray-200 dark:hover:bg-neutral-700',
  'rounded-md',
  'py-2',
  'px-4',
  'border',
  'border-black dark:border-neutral-200',
]);

export function LoadingSpinnerButton({
  loading,
  children,
  className,
  variant,
  ...props
}: { loading: boolean; variant: 'primary' | 'secondary' } & ComponentProps<typeof PrimaryButton>) {
  const Component = variant === 'primary' ? PrimaryButton : SecondaryButton;

  return (
    <Component
      {...props}
      disabled={props.disabled || loading}
      className={clsx('grid place-items-center', className)}
    >
      <span className={clsx('col-span-full row-span-full', loading && 'invisible')}>
        {children}
      </span>
      {loading && <LoadingSpinner className="row-span-full col-span-full" />}
    </Component>
  );
}

export function IconButton({
  icon,
  label,
  size,
  iconClassName,
  iconAfter = false,
  ...props
}: {
  icon: IconType;
  label: string;
  size?: number;
  iconClassName?: string;
  iconAfter?: boolean;
} & React.DetailedHTMLProps<React.ButtonHTMLAttributes<HTMLButtonElement>, HTMLButtonElement>) {
  const Icon = icon;

  return (
    <button
      {...props}
      title={label}
      aria-label={label}
      className={clsx(
        'hover:bg-gray-200 dark:hover:bg-neutral-700',
        'rounded-full',
        'p-2',
        props.className,
      )}
    >
      {iconAfter && props.children}
      <Icon className={iconClassName} size={size || 20} />
      {!iconAfter && props.children}
    </button>
  );
}
