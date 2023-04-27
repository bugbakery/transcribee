import clsx from 'clsx';
import { cloneElement, ReactElement, ReactNode, useState } from 'react';
import { usePopper } from 'react-popper';
import { useEvent } from '../utils/use_event';

const POPUP_OPEN_EVENT = 'popupOpen';
class PopupOpenEvent extends CustomEvent<{ cause: HTMLElement }> {
  constructor(cause: HTMLElement) {
    super(POPUP_OPEN_EVENT, { detail: { cause } });
  }
}

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
  useEvent<PopupOpenEvent>(POPUP_OPEN_EVENT, (e) => {
    if (e.detail.cause != referenceElement) {
      setShow(false);
    }
  });

  return (
    <div ref={setReferenceElement}>
      {cloneElement(button, {
        onClick: () => {
          if (!referenceElement) return;

          if (!show) {
            window.dispatchEvent(new PopupOpenEvent(referenceElement));
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
            'bg-white',
            'border-black',
            'border-2',
            'shadow-brutal',
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
              'before:bg-white',
              "before:content-['']",
              'before:translate-x-[-6px]',
              'before:rotate-45',
              'before:border-l-2',
              'before:border-t-2',
              'before:border-solid',
              'before:border-black',
            )}
          />
        </div>
      ) : (
        <></>
      )}
    </div>
  );
}
