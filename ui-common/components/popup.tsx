import { clsx } from 'clsx';
import { cloneElement, ComponentProps, ReactElement, ReactNode, useRef } from 'react';
import { useOnClickOutside } from '../utils/use_on_click_outside';
import { useStateDelayed } from '../utils/use_state_delayed';
import { IoHelpCircleOutline } from 'react-icons/io5';
import { IconButton } from './button';
import { useFloating, Placement, offset, arrow, flip, shift } from '@floating-ui/react-dom';

export function Popup({
  children,
  button,
  popupClassName = '',
  placement = 'bottom',
  ...props
}: {
  children?: ReactNode;
  button: ReactElement<{ onClick: () => void }>;
  placement?: Placement;
  popupClassName?: string;
} & ComponentProps<'div'>) {
  const arrowRef = useRef(null);
  const {
    refs,
    floatingStyles,
    middlewareData,
    update,
    placement: actualPlacement,
  } = useFloating<HTMLDivElement>({
    placement: placement,
    middleware: [flip(), shift({ padding: 10 }), offset(8), arrow({ element: arrowRef })],
  });
  const [show, setShow] = useStateDelayed(false);
  useOnClickOutside(refs.reference.current, () => {
    setShow(false);
  });

  return (
    <div {...props} ref={refs.setReference}>
      {cloneElement(button, {
        onClick: () => {
          setShow(!show.now);
          if (update) {
            update();
          }
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
            ...floatingStyles,
            transform: `${floatingStyles.transform || ''} ${
              show.late ? 'scale(100%)' : 'scale(75%)'
            }`,
          }}
          ref={refs.setFloating}
        >
          {children}
          <div
            ref={arrowRef}
            style={{
              position: 'absolute',
              left: middlewareData.arrow?.x,
              top: middlewareData.arrow?.y,
            }}
            className={clsx(
              actualPlacement == 'bottom' && ['top-[-7px]', 'before:rotate-45'],
              actualPlacement == 'top' && ['bottom-[4px]', 'before:rotate-[225deg]'],
              actualPlacement == 'right' && [
                'left-[-1px]',
                'before:top-[-8px]',
                'before:rotate-[-45deg]',
              ],
              actualPlacement == 'left' && [
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
          className="inline-block"
          discreet={true}
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
