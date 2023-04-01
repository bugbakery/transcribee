import { primitiveWithClassname } from '../styled';
import { IconType } from 'react-icons';
import clsx from 'clsx';

export const PrimaryButton = primitiveWithClassname('button', [
  'bg-black',
  'hover:bg-gray-700',
  'rounded-md',
  'text-white',
  'py-2',
  'px-4',
]);

export const SecondaryButton = primitiveWithClassname('button', [
  'hover:bg-gray-200',
  'rounded-md',
  'py-2',
  'px-4',
  'border',
  'border-black',
]);

export function IconButton({
  icon,
  label,
  size = undefined,
  ...props
}: { icon: IconType; size?: number; label: string } & React.DetailedHTMLProps<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  HTMLButtonElement
>) {
  const Icon = icon;

  return (
    <button
      {...props}
      title={label}
      aria-label={label}
      className={clsx('hover:bg-gray-200', 'rounded-full', 'p-2', props.className)}
    >
      <Icon size={size || '1.25rem'} />
    </button>
  );
}
