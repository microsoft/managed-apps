import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { CheckmarkCircleRegular } from '@fluentui/react-icons/headless/svg/checkmark-circle';
import { DismissRegular } from '@fluentui/react-icons/headless/svg/dismiss';
import { ErrorCircleRegular } from '@fluentui/react-icons/headless/svg/error-circle';
import { ToastContext, type ToastInput } from '../lib/toast';

interface ToastItem extends ToastInput {
  id: number;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer !== undefined) window.clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const show = useCallback(
    (toast: ToastInput) => {
      const id = nextId.current++;
      setToasts((list) => [...list.slice(-3), { ...toast, id }]);
      const duration = toast.action || toast.tone === 'error' ? 10_000 : 5_000;
      timers.current.set(id, window.setTimeout(() => dismiss(id), duration));
    },
    [dismiss],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((timer) => window.clearTimeout(timer));
  }, []);

  const renderToast = (toast: ToastItem) => (
    <div key={toast.id} className={`toast toast--${toast.tone ?? 'neutral'}`}>
      {toast.tone === 'error' ? (
        <ErrorCircleRegular className="toast__icon" />
      ) : toast.tone === 'success' ? (
        <CheckmarkCircleRegular className="toast__icon" />
      ) : null}
      <p className="toast__message">{toast.message}</p>
      {toast.action && (
        <button
          type="button"
          className="button button--quiet button--small"
          onClick={() => {
            dismiss(toast.id);
            toast.action?.onAction();
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        className="icon-button icon-button--small"
        aria-label="Dismiss notification"
        onClick={() => dismiss(toast.id)}
      >
        <DismissRegular />
      </button>
    </div>
  );

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toasts">
        {/* Errors interrupt (assertive); everything else waits its turn (polite). */}
        <div className="toasts__region" role="status" aria-live="polite" aria-relevant="additions text">
          {toasts.filter((t) => t.tone !== 'error').map(renderToast)}
        </div>
        <div className="toasts__region" role="alert" aria-live="assertive" aria-relevant="additions text">
          {toasts.filter((t) => t.tone === 'error').map(renderToast)}
        </div>
      </div>
    </ToastContext.Provider>
  );
}
