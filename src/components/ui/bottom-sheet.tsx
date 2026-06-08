'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

const BACKDROP_DISMISS_GRACE_MS = 200;

export function BottomSheet({
  open,
  onClose,
  children,
  className,
  ariaLabel,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  ariaLabel?: string;
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
      aria-label={ariaLabel}
      className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40"
      onPointerDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (performance.now() - openedAt.current < BACKDROP_DISMISS_GRACE_MS) return;
        const swallow = (ev: Event) => {
          ev.stopPropagation();
          ev.preventDefault();
        };
        window.addEventListener('click', swallow, { capture: true, once: true });
        window.addEventListener('pointerup', swallow, { capture: true, once: true });
        setTimeout(() => {
          window.removeEventListener('click', swallow, { capture: true });
          window.removeEventListener('pointerup', swallow, { capture: true });
        }, 350);
        onClose();
      }}
    >
      <div
        className={cn(
          'bg-background border-t shadow-2xl rounded-t-xl flex flex-col w-full max-h-[90vh] overflow-y-auto',
          className,
        )}
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
