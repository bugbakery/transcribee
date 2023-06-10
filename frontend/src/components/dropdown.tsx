import clsx from 'clsx';
import { ComponentProps, ReactNode, useState } from 'react';
import useMeasure from 'react-use-measure';

import { IconType } from 'react-icons';
import { useOnClickOutside } from '../utils/use_on_click_outside';
import { useStateDelayed } from '../utils/use_state_delayed';
import { IoIosArrowDown } from 'react-icons/io';

export function DropdownSection({
  children,
  ...props
}: { children?: ReactNode } & ComponentProps<'div'>) {
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
} & ComponentProps<'button'>) {
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
  dropdownClassName = '',
  buttonClassName = '',
  ...props
}: {
  children?: ReactNode;
  label: ReactNode;
  expandTop?: boolean;
  arrow?: boolean;
  expandOn?: boolean;
  dropdownClassName?: string;
  buttonClassName?: string;
} & ComponentProps<'div'>) {
  const [referenceElement, setReferenceElement] = useState<HTMLDivElement | null>(null);
  const [setMeasureReference, bounds] = useMeasure();

  const [show, setShow] = useStateDelayed(false);
  useOnClickOutside(referenceElement, () => {
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
          'text-sm text-left font-semibold',
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
          dropdownClassName,
        )}
        aria-hidden={!show}
        style={{ width: bounds.width }}
      >
        {show.prolonged && children}
      </div>
    </div>
  );
}
