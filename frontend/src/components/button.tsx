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
]);

export function IconButton({
  icon,
  ...props
}: { icon: IconType } & React.DetailedHTMLProps<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  HTMLButtonElement
>) {
  const Icon = icon;

  return (
    <button
      {...props}
      className={clsx('hover:bg-gray-200', 'rounded-full', 'p-2', props.className)}
    >
      <Icon size={'1.25rem'} />
    </button>
  );
}
