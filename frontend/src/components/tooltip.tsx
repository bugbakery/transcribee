import clsx from 'clsx';
import React, { useEffect, useState } from 'react';
import { usePopper } from 'react-popper';
import { Placement } from '@popperjs/core';
import { useStateDelayed } from '../utils/use_state_delayed';

export function Tooltip({
  children,
  tooltipText,
  placements = 'bottom',
  fallbackPlacements = ['top'],
  ...props
}: {
  children?: React.ReactNode;
  tooltipText: React.ReactNode;
  placements?: Placement;
  fallbackPlacements?: Placement[];
} & React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement>) {
  const [referenceElement, setReferenceElement] = useState<HTMLDivElement | null>(null);
  const [popperElement, setPopperElement] = useState<HTMLDivElement | null>(null);
  const [arrowElement, setArrowElement] = useState<HTMLDivElement | null>(null);

  const { styles, attributes } = usePopper(referenceElement, popperElement, {
    placement: placements,
    modifiers: [
      {
        name: 'flip',
        options: {
          fallbackPlacements: fallbackPlacements,
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

  useEffect(() => {
    if (referenceElement === null) {
      return;
    }
    const showEvents = ['mouseenter', 'focus'];
    const hideEvents = ['mouseleave', 'blur'];

    const show = () => setShow(true);
    const hide = () => setShow(false);

    showEvents.forEach((event) => {
      referenceElement.addEventListener(event, show);
    });

    hideEvents.forEach((event) => {
      referenceElement.addEventListener(event, hide);
    });
    return () => {
      showEvents.forEach((event) => {
        referenceElement.removeEventListener(event, show);
      });

      hideEvents.forEach((event) => {
        referenceElement.removeEventListener(event, hide);
      });
    };
  }, [referenceElement]);

  return (
    <div {...props} ref={setReferenceElement}>
      {children}
      {show.prolonged && tooltipText ? (
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
            'group',
          )}
          style={styles.popper}
          ref={setPopperElement}
          {...attributes.popper}
        >
          {tooltipText}
          <div
            ref={setArrowElement}
            style={styles.arrow}
            className={clsx(
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

              'group-data-[popper-placement=bottom]:top-[-7px]',
              'group-data-[popper-placement=bottom]:before:rotate-[45deg]',

              'group-data-[popper-placement=top]:bottom-[4px]',
              'group-data-[popper-placement=top]:before:rotate-[225deg]',
            )}
          />
        </div>
      ) : (
        <></>
      )}
    </div>
  );
}
