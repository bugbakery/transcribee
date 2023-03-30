import clsx from 'clsx';
import { ReactNode, useState } from 'react';
import { usePopper } from 'react-popper';
import SecondaryButton from './SecondaryButton';

export function TooltipButton({ children, text }: { children?: ReactNode; text: string }) {
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
      <SecondaryButton
        onClick={() => {
          setShow((old) => !old);
          update && update();
        }}
      >
        {text}
      </SecondaryButton>
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
