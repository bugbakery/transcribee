import { clsx } from 'clsx';
import React, { ComponentProps, useEffect, useRef } from 'react';
import { useFloating, Placement, offset, arrow, flip } from '@floating-ui/react-dom';
import { useStateDelayed } from '../utils/use_state_delayed';

export function Tooltip({
  children,
  tooltipText,
  placement = 'bottom',
  fallbackPlacements = ['bottom', 'top'],
  ...props
}: {
  children?: React.ReactNode;
  tooltipText: React.ReactNode;
  placement?: Placement;
  fallbackPlacements?: Placement[];
} & ComponentProps<'div'>) {
  const arrowRef = useRef(null);
  const {
    refs,
    floatingStyles,
    middlewareData,
    placement: actualPlacement,
  } = useFloating<HTMLDivElement>({
    placement,
    middleware: [flip({ fallbackPlacements }), offset(9), arrow({ element: arrowRef })],
  });

  const [show, setShow] = useStateDelayed(false, { late: 1, prolong: 1 });
  useEffect(() => {
    const referenceElement = refs.reference.current;
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
  }, [refs.reference.current]);

  return (
    <div {...props} ref={refs.setReference}>
      {children}
      {show.prolonged && tooltipText ? (
        <div
          className={clsx(
            'px-3 py-1.5',
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
          style={floatingStyles}
          ref={refs.setFloating}
        >
          {tooltipText}
          <div
            ref={arrowRef}
            style={{
              position: 'absolute',
              left: middlewareData.arrow?.x,
              top: middlewareData.arrow?.y,
            }}
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
              actualPlacement == 'bottom' && ['top-[-7px]', 'before:rotate-45'],
              actualPlacement == 'top' && ['bottom-[4px]', 'before:rotate-[225deg]'],
              actualPlacement == 'right' && [
                'left-[-1px]',
                'before:top-[-6px]',
                'before:rotate-[-45deg]',
              ],
              actualPlacement == 'left' && [
                'right-[-2px]',
                'before:top-[-6px]',
                'before:rotate-[135deg]',
              ],
            )}
          />
        </div>
      ) : (
        <></>
      )}
    </div>
  );
}
