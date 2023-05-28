import { primitiveWithClassname } from '../styled';
import { IconType } from 'react-icons';
import clsx from 'clsx';

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

export function IconButton({
  icon,
  label,
  size,
  iconClassName,
  ...props
}: {
  icon: IconType;
  label: string;
  size?: number;
  iconClassName?: string;
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
      <Icon className={iconClassName} size={size || 20} />
    </button>
  );
}
