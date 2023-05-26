import clsx from 'clsx';
import { cloneElement, ComponentProps, ReactElement, ReactNode, useState } from 'react';
import { usePopper } from 'react-popper';
import { useOnClickOutside } from '../utils/use_on_click_outside';
import { useStateDelayed } from '../utils/use_state_delayed';

export function Popup({
  children,
  button,
  popupClassName = '',
  ...props
}: {
  children?: ReactNode;
  button: ReactElement;
  popupClassName?: string;
} & ComponentProps<'div'>) {
  const [referenceElement, setReferenceElement] = useState<HTMLDivElement | null>(null);
  const [popperElement, setPopperElement] = useState<HTMLDivElement | null>(null);
  const [arrowElement, setArrowElement] = useState<HTMLDivElement | null>(null);

  const { styles, attributes, update } = usePopper(referenceElement, popperElement, {
    placement: 'bottom',
    modifiers: [
      {
        name: 'flip',
        options: {
          fallbackPlacements: ['top'],
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
              'top-[-7px]',
              'before:absolute',
              'before:w-[11px]',
              'before:h-[11px]',
              'before:bg-white dark:before:bg-neutral-900',
              "before:content-['']",
              'before:translate-x-[-6px]',
              'before:rotate-45',
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
