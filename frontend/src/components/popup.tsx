import clsx from 'clsx';
import { cloneElement, ReactElement, ReactNode, useState } from 'react';
import { usePopper } from 'react-popper';

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
          {...props}
          className={clsx(
            'p-4',
            'bg-white',
            'border-black',
            'border-2',
            'shadow-brutal',
            'rounded-lg',
            props.className,
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
