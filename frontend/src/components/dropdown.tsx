import clsx from 'clsx';
import { ReactNode, useState } from 'react';
import { useEvent } from '../utils/use_event';

import { IoIosArrowDown, IoIosArrowUp } from 'react-icons/io';
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
    <div {...props} className="block" role="none">
      {children}
    </div>
  );
}
export function DropdownItem({
  children,
  icon,
  first,
  last,
  disabled = false,
  ...props
}: {
  icon?: IconType;
  first?: boolean;
  last?: boolean;
  disabled?: boolean;
} & React.DetailedHTMLProps<React.HTMLAttributes<HTMLButtonElement>, HTMLButtonElement>) {
  const Icon = icon;
  return (
    <button
      {...props}
      className={clsx(
        'flex items-center',
        'w-full',
        'px-4 py-2',
        'hover:bg-gray-200 dark:hover:bg-neutral-700',
        first ? 'rounded-t-md' : '',
        last ? 'rounded-b-md' : '',
        disabled ? 'text-slate-500 dark:text-neutral-400' : '',
      )}
      role="menuitem"
      type="button"
      disabled={disabled}
    >
      {Icon ? <Icon className="pr-2" size={'2em'} /> : <></>}
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
  const [show, setShow] = useState(false);

  useEvent<DropdownOpenEvent>(DROPDOWN_OPEN_EVENT, (e) => {
    if (e.detail.cause != referenceElement) {
      setShow(false);
    }
  });

  return (
    <div
      ref={setReferenceElement}
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
          '-mt-1.5',
          'inline-flex items-stretch',
          'w-full rounded-lg',
          'text-sm font-semibold',
          'hover:bg-gray-200 dark:hover:bg-neutral-700',
          'group',
          'px-3 py-2',
        )}
        aria-expanded={show}
        aria-haspopup="true"
      >
        <div className="flex-grow break-all text-start">{label}</div>
        <div className={clsx('flex text-slate-500 dark:text-neutral-400')}>
          {show ? (
            <IoIosArrowUp className="self-center" />
          ) : (
            <IoIosArrowDown className="self-center" />
          )}
        </div>
      </button>
      <div
        {...props}
        className={clsx(
          'absolute left-0 z-10 mt-1',
          'bg-white dark:bg-neutral-900',
          'border-2',
          'border-black dark:border-neutral-200',
          'rounded-lg',
          'divide-y divide-black dark:divide-neutral-200',
          'transition-scale duration-100 origin-top-left',
          show ? 'scale-100 opacity-100' : 'scale-75 opacity-0 pointer-events-none',
        )}
        aria-hidden={!show}
      >
        {children}
      </div>
    </div>
  );
}
