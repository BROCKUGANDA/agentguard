import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import clsx from 'clsx';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  closeOnBackdrop?: boolean;
}

const SIZE: Record<NonNullable<ModalProps['size']>, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
};

const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  size = 'md',
  closeOnBackdrop = true,
}: ModalProps): JSX.Element | null {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      // Focus trap: keep Tab cycling within the modal.
      if (e.key === 'Tab' && panelRef.current) {
        const focusable = Array.from(
          panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey) {
          if (active === first || !panelRef.current.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (active === last || !panelRef.current.contains(active)) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    // Focus the first interactive element on open.
    requestAnimationFrame(() => {
      if (panelRef.current) {
        const focusable = panelRef.current.querySelector<HTMLElement>(FOCUSABLE);
        (focusable ?? panelRef.current).focus();
      }
    });
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-md"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        aria-hidden
        className="absolute inset-0 bg-black/40 backdrop-blur-sm ag-modal-enter"
        onClick={() => {
          if (closeOnBackdrop) onClose();
        }}
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        className={clsx(
          'relative w-full bg-surface border border-border rounded-lg shadow-xl ag-modal-enter outline-none',
          SIZE[size],
        )}
      >
        {(title || description) && (
          <div className="flex items-start justify-between gap-md p-md border-b border-border">
            <div>
              {title && (
                <h2 className="text-lg font-semibold text-text">{title}</h2>
              )}
              {description && (
                <p className="text-sm text-text-muted mt-1">{description}</p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1 text-text-muted hover:bg-border/60 hover:text-text transition-colors"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>
        )}
        <div className="p-md">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export default Modal;