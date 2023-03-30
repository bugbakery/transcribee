import clsx from 'clsx';
import { IconType } from 'react-icons';

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
