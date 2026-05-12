'use client';

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

/**
 * Centered modal dialog with a backdrop. Renders into `document.body` via a
 * portal so it escapes any ancestor `overflow:hidden` / transform stack.
 *
 * Closes on backdrop click and Escape. The body's `overflow` is locked
 * while open so the page underneath doesn't scroll.
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
  useEffect(() => {
    if (!open) return;
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
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={cn(
          'bg-background relative flex w-full max-w-lg flex-col gap-4 rounded-lg border p-5 shadow-xl',
          className,
        )}
      >
        {title && (
          <header className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold">{title}</h2>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 -mr-1"
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
