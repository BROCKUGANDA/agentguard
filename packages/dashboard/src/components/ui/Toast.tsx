import { create } from 'zustand';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from 'lucide-react';
import clsx from 'clsx';

export type ToastTone = 'success' | 'warning' | 'error' | 'info';

export interface Toast {
  id: string;
  tone: ToastTone;
  title: string;
  description?: string;
  durationMs?: number;
}

interface ToastState {
  toasts: Toast[];
  push: (t: Omit<Toast, 'id'>) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

const useToastStore = create<ToastState>((setState) => ({
  toasts: [],
  push: (t) => {
    const id = `toast-${Math.random().toString(36).slice(2, 9)}`;
    setState((s) => ({ toasts: [...s.toasts, { ...t, id }] }));
    return id;
  },
  dismiss: (id) =>
    setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  clear: () => setState({ toasts: [] }),
}));

export function useToast(): {
  push: ToastState['push'];
  dismiss: ToastState['dismiss'];
  success: (title: string, description?: string) => string;
  error: (title: string, description?: string) => string;
  warning: (title: string, description?: string) => string;
  info: (title: string, description?: string) => string;
} {
  const push = useToastStore((s) => s.push);
  const dismiss = useToastStore((s) => s.dismiss);
  return {
    push,
    dismiss,
    success: (title, description) =>
      push({ tone: 'success', title, description, durationMs: 4000 }),
    error: (title, description) =>
      push({ tone: 'error', title, description, durationMs: 6000 }),
    warning: (title, description) =>
      push({ tone: 'warning', title, description, durationMs: 5000 }),
    info: (title, description) =>
      push({ tone: 'info', title, description, durationMs: 4000 }),
  };
}

const TONE_BG: Record<ToastTone, string> = {
  success: 'border-success/40 bg-success/10 text-text',
  error: 'border-error/40 bg-error/10 text-text',
  warning: 'border-warning/40 bg-warning/10 text-text',
  info: 'border-info/40 bg-info/10 text-text',
};

const TONE_ICON: Record<ToastTone, JSX.Element> = {
  success: <CheckCircle2 size={18} className="text-success" />,
  error: <XCircle size={18} className="text-error" />,
  warning: <AlertTriangle size={18} className="text-warning" />,
  info: <Info size={18} className="text-info" />,
};

function ToastItem({ toast }: { toast: Toast }): JSX.Element {
  const dismiss = useToastStore((s) => s.dismiss);
  useEffect(() => {
    const timer = window.setTimeout(
      () => dismiss(toast.id),
      toast.durationMs ?? 4000,
    );
    return () => window.clearTimeout(timer);
  }, [toast.id, toast.durationMs, dismiss]);

  return (
    <div
      role="status"
      className={clsx(
        'pointer-events-auto flex items-start gap-2.5 rounded-md border bg-surface shadow-lg px-md py-sm min-w-[280px] max-w-md ag-toast-enter',
        TONE_BG[toast.tone],
      )}
    >
      <div className="mt-0.5">{TONE_ICON[toast.tone]}</div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-text">{toast.title}</div>
        {toast.description && (
          <div className="text-xs text-text-muted mt-0.5">{toast.description}</div>
        )}
      </div>
      <button
        type="button"
        onClick={() => dismiss(toast.id)}
        className="text-text-muted hover:text-text rounded-sm p-0.5"
        aria-label="Dismiss notification"
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function ToastHost(): JSX.Element | null {
  const toasts = useToastStore((s) => s.toasts);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="pointer-events-none fixed top-md right-md z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>,
    document.body,
  );
}

export default ToastHost;