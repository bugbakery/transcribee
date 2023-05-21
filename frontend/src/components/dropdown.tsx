import clsx from 'clsx';
import { ReactNode, useState } from 'react';
import useMeasure from 'react-use-measure';

import { IoIosArrowDown } from 'react-icons/io';
import { IconType } from 'react-icons';
import { useOnBlur } from '../utils/use_blur';
import { useStateDelayed } from '../utils/use_state_delayed';

export function DropdownSection({
  children,
  ...props
}: { children?: ReactNode } & React.DetailedHTMLProps<
  React.HTMLAttributes<HTMLDivElement>,
  HTMLDivElement
>) {
  return (
    <div {...props} className="block py-1.5" role="none">
      {children}
    </div>
  );
}
export function DropdownItem({
  children,
  icon,
  disabled = false,
  ...props
}: {
  icon?: IconType;
  disabled?: boolean;
} & React.DetailedHTMLProps<React.HTMLAttributes<HTMLButtonElement>, HTMLButtonElement>) {
  const Icon = icon;
  return (
    <button
      {...props}
      className={clsx(
        'flex items-center',
        'w-full',
        'px-3 py-1',
        'rounded-none',
        'hover:bg-gray-200 dark:hover:bg-neutral-700',
        disabled ? 'text-slate-500 dark:text-neutral-400' : '',
        props.className,
      )}
      role="menuitem"
      type="button"
      disabled={disabled}
    >
      {Icon ? <Icon className="pr-2" size={'1.75em'} /> : <></>}
      {children}
    </button>
  );
}
export function Dropdown({
  children,
  label,
  expandTop = false,
  expandOn = false,
  arrow = true,
  buttonClassName = '',
  ...props
}: {
  children?: ReactNode;
  label: ReactNode;
  expandTop?: boolean;
  arrow?: boolean;
  expandOn?: boolean;
  buttonClassName?: string;
} & React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement>) {
  const [referenceElement, setReferenceElement] = useState<HTMLDivElement | null>(null);
  const [setMeasureReference, bounds] = useMeasure();

  const [show, setShow] = useStateDelayed(false);
  useOnBlur(referenceElement, () => {
    setShow(false);
  });

  const inverseDirection = expandTop ? 'bottom' : 'top';

  return (
    <div
      {...props}
      ref={(ref) => {
        setReferenceElement(ref);
        setMeasureReference(ref);
      }}
      onClick={() => {
        setShow(!show.now);
      }}
      className={clsx('relative', props.className)}
    >
      <button
        type="button"
        className={clsx(
          'inline-flex items-stretch',
          'w-full rounded-lg',
          'text-sm font-semibold',
          'hover:bg-gray-200 dark:hover:bg-neutral-700',
          show.now && 'bg-gray-200 dark:bg-neutral-700',
          'px-2 py-1',
          buttonClassName,
        )}
        aria-expanded={show.now}
        aria-haspopup="true"
      >
        {arrow && (
          <div className={clsx('flex text-slate-500 dark:text-neutral-400 px-1')}>
            <IoIosArrowDown
              className={clsx('self-center transition-all duration-100', show.now || '-rotate-90')}
            />
          </div>
        )}
        <div className="flex-grow break-all text-start">{label}</div>
      </button>
      <div
        className={clsx(
          'absolute left-0 z-10 my-1',
          `${inverseDirection}-${expandOn ? '0' : 'full'}`,
          'bg-white dark:bg-neutral-900',
          'border-2 border-black dark:border-neutral-200',
          'shadow-brutal shadow-slate-400 dark:shadow-neutral-600',
          'rounded-lg',
          'divide-y divide-black dark:divide-neutral-200',
          'transition-scale duration-100',
          `origin-${inverseDirection}`,
          show.late ? 'scale-100 opacity-100' : 'scale-75 opacity-0 pointer-events-none',
        )}
        aria-hidden={!show}
        style={{ minWidth: bounds.width }}
      >
        {show.prolonged && children}
      </div>
    </div>
  );
}
