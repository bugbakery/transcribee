import clsx from 'clsx';
import { cloneElement, ReactElement, ReactNode, useEffect, useState } from 'react';
import { usePopper } from 'react-popper';

const POPUP_OPEN_EVENT = 'popupOpen';
class PopupOpenEvent extends CustomEvent<{ cause: HTMLElement }> {
  constructor(cause: HTMLElement) {
    super(POPUP_OPEN_EVENT, { detail: { cause } });
  }
}

function useOnPopupOpen(callback: (cause: HTMLElement) => void) {
  useEffect(() => {
    const listener = (e: Event) => {
      const event = e as PopupOpenEvent;
      callback(event.detail.cause);
    };

    window.addEventListener(POPUP_OPEN_EVENT, listener);
    () => {
      window.removeEventListener(POPUP_OPEN_EVENT, listener);
    };
  }, [callback]);
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
  useOnPopupOpen((cause) => {
    if (cause != referenceElement) {
      setShow(false);
    }
  });

  return (
    <div ref={setReferenceElement}>
      {cloneElement(button, {
        onClick: () => {
          if (!referenceElement) return;

          if (!show) {
            const event = new PopupOpenEvent(referenceElement);
            window.dispatchEvent(event);
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
            props.className,
          )}
          id="pop"
          style={styles.popper}
          ref={setPopperElement}
          {...attributes.popper}
        >
          {children}
          <div ref={setArrowElement} style={styles.arrow} id="arrow" />
        </div>
      ) : (
        <></>
      )}
    </div>
  );
}
