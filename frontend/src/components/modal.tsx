import { useEffect, useRef, useState } from 'react';
import { useEvent } from '../utils/use_event';
import { Dialog, DialogTitle } from './dialog';

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
  const [modalElement, setModalElement] = useState(null as JSX.Element | null);

  useEvent<ShowModalEvent>(SHOW_MODAL_EVENT, (e) => {
    setModalElement(e.detail.cause);
  });

  return <>{modalElement}</>;
}

export const ModalTitle = DialogTitle;

export function Modal({
  children,
  onClose,
  label,
  ...props
}: { onClose: () => void; label: string } & React.DetailedHTMLProps<
  React.HTMLAttributes<HTMLDivElement>,
  HTMLDivElement
>) {
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
      className="relative z-10"
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
      <div className="fixed inset-0 bg-white dark:bg-neutral-900 bg-opacity-75 dark:bg-opacity-75" />

      <div className="fixed inset-0 z-10 overflow-y-auto">
        <div className="flex min-h-full justify-center text-center items-center p-0">
          <Dialog ref={dialogRef}>
            <ModalTitle id="modal-title">{label}</ModalTitle>
            {children}
          </Dialog>
        </div>
      </div>
    </div>
  );
}
