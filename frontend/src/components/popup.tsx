import clsx from 'clsx';
import { cloneElement, ComponentProps, ReactElement, ReactNode, useState } from 'react';
import { usePopper } from 'react-popper';
import { useOnClickOutside } from '../utils/use_on_click_outside';
import { useStateDelayed } from '../utils/use_state_delayed';
import { IoHelpCircleOutline } from 'react-icons/io5';
import { IconButton } from './button';
import { Placement } from '@popperjs/core';

export function Popup({
  children,
  button,
  popupClassName = '',
  placement = 'bottom',
  ...props
}: {
  children?: ReactNode;
  button: ReactElement;
  placement?: Placement;
  popupClassName?: string;
} & ComponentProps<'div'>) {
  const [referenceElement, setReferenceElement] = useState<HTMLDivElement | null>(null);
  const [popperElement, setPopperElement] = useState<HTMLDivElement | null>(null);
  const [arrowElement, setArrowElement] = useState<HTMLDivElement | null>(null);

  const { styles, attributes, update } = usePopper(referenceElement, popperElement, {
    placement: placement,
    modifiers: [
      {
        name: 'flip',
        options: {
          fallbackPlacements: ['bottom', 'top', 'right', 'left'],
          flipVariations: true,
        },
      },
      {
        name: 'offset',
        options: {
          offset: [0, 8],
        },
      },
      {
        name: 'arrow',
        options: {
          element: arrowElement,
        },
      },
    ],
  });
  const [show, setShow] = useStateDelayed(false);
  useOnClickOutside(referenceElement, () => {
    setShow(false);
  });

  return (
    <div {...props} ref={setReferenceElement}>
      {cloneElement(button, {
        onClick: () => {
          setShow(!show.now);
          update && update();
        },
      })}

      {show.prolonged && (
        <div
          className={clsx(
            'p-4',
            'bg-white dark:bg-neutral-900',
            'border-black dark:border-neutral-200',
            'border-2',
            'shadow-brutal',
            'shadow-slate-400 dark:shadow-neutral-600',
            'rounded-lg',
            'relative',
            'z-10',
            show.now && !show.late && 'transition-none',
            'duration-100 origin-top',
            show.late ? 'opacity-100' : 'opacity-0 pointer-events-none',
            popupClassName,
          )}
          aria-hidden={!show.now}
          style={{
            ...styles.popper,
            transform: `${styles.popper.transform || ''} ${
              show.late ? 'scale(100%)' : 'scale(75%)'
            }`,
          }}
          ref={setPopperElement}
          {...attributes.popper}
        >
          {children}
          <div
            ref={setArrowElement}
            style={styles.arrow}
            className={clsx(
              attributes?.popper?.['data-popper-placement'] == 'bottom' && [
                'top-[-7px]',
                'before:rotate-45',
              ],
              attributes?.popper?.['data-popper-placement'] == 'top' && [
                'bottom-[4px]',
                'before:rotate-[225deg]',
              ],
              attributes?.popper?.['data-popper-placement'] == 'right' && [
                'left-[-1px]',
                'before:top-[-8px]',
                'before:rotate-[-45deg]',
              ],
              attributes?.popper?.['data-popper-placement'] == 'left' && [
                'right-[-2px]',
                'before:top-[-8px]',
                'before:rotate-[135deg]',
              ],
              'before:absolute',
              'before:w-[11px]',
              'before:h-[11px]',
              'before:bg-white dark:before:bg-neutral-900',
              "before:content-['']",
              'before:translate-x-[-6px]',
              'before:border-l-2',
              'before:border-t-2',
              'before:border-solid',
              'before:border-black dark:before:border-neutral-200',
            )}
          />
        </div>
      )}
    </div>
  );
}

export function HelpPopup({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <Popup
      className={clsx('inline-block align-text-top absolute right-0', className)}
      popupClassName="w-[300px]"
      button={
        <IconButton
          className="inline-block !p-0 !bg-transparent"
          icon={IoHelpCircleOutline}
          label={`help`}
        />
      }
      placement="right"
      onClick={(e) => {
        e.preventDefault();
      }}
    >
      {children}
    </Popup>
  );
}
