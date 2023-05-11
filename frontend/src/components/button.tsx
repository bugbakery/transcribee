import { primitiveWithClassname } from '../styled';
import { IconType } from 'react-icons';
import clsx from 'clsx';

export const PrimaryButton = primitiveWithClassname('button', [
  'bg-black dark:bg-neutral-200',
  'hover:bg-gray-700 dark:hover:bg-neutral-300',
  'rounded-md',
  'text-white dark:text-black',
  'py-2',
  'px-4',
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
        'hover:bg-gray-200 dark:hover:bg-gray-700',
        'rounded-full',
        'p-2',
        props.className,
      )}
    >
      <Icon className={iconClassName} size={size || 20} />
    </button>
  );
}
