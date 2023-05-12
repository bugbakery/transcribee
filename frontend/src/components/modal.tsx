import { cloneElement, useEffect, useRef, useState } from 'react';
import { useEvent } from '../utils/use_event';
import { Dialog, DialogTitle } from './dialog';
import clsx from 'clsx';

const SHOW_MODAL_EVENT = 'showModal';
class ShowModalEvent extends CustomEvent<{ children: JSX.Element | null }> {
  constructor(cause: JSX.Element | null) {
    super(SHOW_MODAL_EVENT, { detail: { children: cause } });
  }
}

export function showModal(children: JSX.Element | null) {
  window.dispatchEvent(new ShowModalEvent(children));
}

export function ModalHolder(): JSX.Element {
  const [modalChildren, setModalChildren] = useState(null as JSX.Element | null);
  const [transitionClassName, setTransitionClassName] = useState('');

  useEvent<ShowModalEvent>(SHOW_MODAL_EVENT, (e) => {
    if (e.detail.children !== null) {
      setTransitionClassName('opacity-50 scale-95');
      requestAnimationFrame(() =>
        setTransitionClassName('opacity-100 scale-100 transition-all duration-75'),
      );
      setModalChildren(e.detail.children);
    } else {
      setTransitionClassName('opacity-50 scale-95 transition-all duration-100');
      setTimeout(() => {
        setModalChildren(null);
      }, 100);
    }
  });

  return modalChildren ? (
    <>
      {cloneElement(modalChildren, {
        transitionClassName,
      })}
    </>
  ) : (
    <></>
  );
}

export const ModalTitle = DialogTitle;

export type ModalProps = {
  onClose: () => void;
  label: string;
  transitionClassName?: string;
} & React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement>;

export function Modal({ children, onClose, label, transitionClassName, ...props }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>();
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key == 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div
      {...props}
      className={clsx('relative z-10')}
      aria-labelledby="modal-title"
      role="dialog"
      aria-modal="true"
      contentEditable={false}
      onClick={(e) => {
        const target = e.target as Element;
        if (!dialogRef.current) {
          return;
        }
        if (dialogRef.current.contains(target)) {
          return;
        }
        onClose();
      }}
    >
      <div
        className={clsx(
          'fixed inset-0 bg-white dark:bg-neutral-900 bg-opacity-75 dark:bg-opacity-75',
          transitionClassName,
        )}
      />

      <div className="fixed inset-0 z-10 overflow-y-auto">
        <div
          className={clsx(
            'flex min-h-full justify-center text-center items-center p-0',
            transitionClassName,
          )}
        >
          <Dialog ref={dialogRef}>
            <ModalTitle id="modal-title">{label}</ModalTitle>
            {children}
          </Dialog>
        </div>
      </div>
    </div>
  );
}
