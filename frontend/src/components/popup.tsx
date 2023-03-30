import clsx from 'clsx';
import { cloneElement, ReactElement, ReactNode, useState } from 'react';
import { usePopper } from 'react-popper';

export function Popup({ children, button }: { children?: ReactNode; button: ReactElement }) {
  const [referenceElement, setReferenceElement] = useState<HTMLDivElement | null>(null);
  const [popperElement, setPopperElement] = useState<HTMLDivElement | null>(null);

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
    ],
  });
  const [show, setShow] = useState(false);

  return (
    <div ref={setReferenceElement}>
      {cloneElement(button, {
        onClick: () => {
          setShow((old) => !old);
          update && update();
        },
      })}

      {show ? (
        <div
          className={clsx(
            'p-4',
            'bg-white',
            'border-black',
            'border-2',
            'shadow-brutal',
            'rounded-lg',
            'm-2',
          )}
          style={styles.popper}
          ref={setPopperElement}
          {...attributes.popper}
        >
          {children}
        </div>
      ) : (
        <></>
      )}
    </div>
  );
}
