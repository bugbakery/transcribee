import clsx from 'clsx';
import { ReactNode, useState } from 'react';
import { useEvent } from '../utils/use_event';
import useMeasure from 'react-use-measure';

import { IoIosArrowDown } from 'react-icons/io';
import { IconType } from 'react-icons';

const DROPDOWN_OPEN_EVENT = 'dropdownOpen';
class DropdownOpenEvent extends CustomEvent<{ cause: HTMLElement }> {
  constructor(cause: HTMLElement) {
    super(DROPDOWN_OPEN_EVENT, { detail: { cause } });
  }
}

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
  ...props
}: { children?: ReactNode; label: string } & React.DetailedHTMLProps<
  React.HTMLAttributes<HTMLDivElement>,
  HTMLDivElement
>) {
  const [referenceElement, setReferenceElement] = useState<HTMLDivElement | null>(null);
  const [setMeasureReference, bounds] = useMeasure();
  const [show, setShow] = useState(false);

  useEvent<DropdownOpenEvent>(DROPDOWN_OPEN_EVENT, (e) => {
    if (e.detail.cause != referenceElement) {
      setShow(false);
    }
  });

  return (
    <div
      {...props}
      ref={(ref) => {
        setReferenceElement(ref);
        setMeasureReference(ref);
      }}
      onClick={() => {
        if (!referenceElement) return;

        if (!show) {
          window.dispatchEvent(new DropdownOpenEvent(referenceElement));
          setShow(true);
        } else {
          setShow(false);
        }
      }}
    >
      <button
        type="button"
        className={clsx(
          '-mt-1',
          'inline-flex items-stretch',
          'w-full rounded-lg',
          'text-sm font-semibold',
          'hover:bg-gray-200 dark:hover:bg-neutral-700',
          show && 'bg-gray-200 dark:bg-neutral-700',
          'pl-2 py-1',
        )}
        aria-expanded={show}
        aria-haspopup="true"
      >
        <div className={clsx('flex text-slate-500 dark:text-neutral-400 pr-1')}>
          <IoIosArrowDown
            className={clsx('self-center transition-all duration-100', show || '-rotate-90')}
          />
        </div>
        <div className="flex-grow break-all text-start">{label}</div>
      </button>
      <div
        className={clsx(
          'absolute left-0 z-10 mt-1',
          'bg-white dark:bg-neutral-900',
          'border-2 border-black dark:border-neutral-200',
          'shadow-brutal shadow-slate-400 dark:shadow-neutral-600',
          'rounded-lg',
          'divide-y divide-black dark:divide-neutral-200',
          'transition-scale duration-100 origin-top-left',
          show ? 'scale-100 opacity-100' : 'scale-75 opacity-0 pointer-events-none',
        )}
        aria-hidden={!show}
        style={{ minWidth: bounds.width }}
      >
        {children}
      </div>
    </div>
  );
}
