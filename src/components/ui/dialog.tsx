import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

const BACKDROP_DISMISS_GRACE_MS = 200;

/**
 * Modal dialog with a backdrop. Renders into `document.body` via a portal so
 * it escapes any ancestor `overflow:hidden` / transform stack.
 *
 * On mobile (< sm) it docks to the bottom as a sheet — easier for one-handed
 * use than a top-anchored card. On `sm+` it floats centered. Closes on
 * backdrop click and Escape; body scroll is locked while open.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const openedAt = useRef(0);

  useEffect(() => {
    if (!open) return;
    openedAt.current = performance.now();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (typeof document === 'undefined' || !open) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:overflow-y-auto sm:p-4"
      onPointerDown={(e) => {
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
      }}
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        if (performance.now() - openedAt.current < BACKDROP_DISMISS_GRACE_MS) return;
        onClose();
      }}
    >
      <div
        className={cn(
          'bg-background relative flex w-full max-w-lg flex-col gap-4 border p-5 shadow-xl',
          'max-h-[90vh] overflow-y-auto rounded-t-xl rounded-b-none border-b-0',
          'sm:max-h-none sm:overflow-visible sm:rounded-lg sm:border-b',
          className,
        )}
        style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}
      >
        {title && (
          <header className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold">{title}</h2>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="-mr-1 size-7"
              onClick={onClose}
              aria-label="Close"
            >
              <X className="size-4" />
            </Button>
          </header>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}
