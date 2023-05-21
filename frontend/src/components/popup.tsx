import clsx from 'clsx';
import { cloneElement, ReactElement, ReactNode, useState } from 'react';
import { usePopper } from 'react-popper';
import { useOnBlur } from '../utils/use_blur';

export function Popup({
  children,
  button,
  ...props
}: { children?: ReactNode; button: ReactElement } & React.DetailedHTMLProps<
  React.HTMLAttributes<HTMLDivElement>,
  HTMLDivElement
>) {
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
  const [show, setShow] = useState(false);
  useOnBlur(referenceElement, () => {
    setShow(false);
  });

  return (
    <div ref={setReferenceElement}>
      {cloneElement(button, {
        onClick: () => {
          if (!referenceElement) return;

          if (!show) {
            setShow(true);
          } else {
            setShow(false);
          }

          update && update();
        },
      })}

      {show ? (
        <div
          {...props}
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
            props.className,
          )}
          style={styles.popper}
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
      ) : (
        <></>
      )}
    </div>
  );
}
