import { useEffect, useId, useRef, type ReactNode } from 'react';
import { DismissRegular } from '@fluentui/react-icons/headless/svg/dismiss';
import { Spinner } from './Spinner';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md';
  /** Prevents Esc / close button while a save is in flight. */
  busy?: boolean;
}

/**
 * Native modal <dialog>: the browser traps focus and makes the page inert.
 * Focus returns to the element that opened it.
 */
export function Modal({ open, onClose, title, description, children, footer, size = 'md', busy = false }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
      const preferred = dialog.querySelector<HTMLElement>('[data-autofocus]');
      preferred?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  const handleClose = () => {
    const dialog = ref.current;
    // A stale close event (e.g. StrictMode's effect replay) after the dialog was re-shown.
    if (!dialog || dialog.open) return;
    if (open) {
      // The browser closed it on its own (Chromium force-closes on a repeated Esc even when
      // cancel is prevented). Keep it up while saving so the result stays visible; otherwise sync state.
      if (busy) {
        dialog.showModal();
        return;
      }
      onClose();
    }
    const target = opener.current;
    opener.current = null;
    if (target && target.isConnected) target.focus();
    else document.getElementById('main')?.focus();
  };

  return (
    <dialog
      ref={ref}
      className={`modal modal--${size}`}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onClose={handleClose}
    >
      {open && (
        <div className="modal__frame">
          <header className="modal__header">
            <h2 id={titleId} className="modal__title">
              {title}
            </h2>
            <button type="button" className="icon-button" aria-label="Close" onClick={onClose} disabled={busy}>
              <DismissRegular />
            </button>
          </header>
          {description && (
            <div id={descriptionId} className="modal__description">
              {description}
            </div>
          )}
          <div className="modal__body">{children}</div>
          {footer && <footer className="modal__footer">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

interface ConfirmProps {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  error?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ open, title, message, confirmLabel, danger, busy, error, onConfirm, onCancel }: ConfirmProps) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      size="sm"
      busy={busy}
      footer={
        <>
          <button type="button" className="button" onClick={onCancel} disabled={busy} data-autofocus>
            Keep it
          </button>
          <button
            type="button"
            className={`button ${danger ? 'button--danger' : 'button--primary'}`}
            onClick={onConfirm}
            disabled={busy}
            aria-busy={busy || undefined}
          >
            {busy && <Spinner />}
            {busy ? 'Working…' : confirmLabel}
          </button>
        </>
      }
    >
      <div className="confirm-message">{message}</div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
