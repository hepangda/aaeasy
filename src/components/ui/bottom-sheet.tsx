import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { useModalLayer } from '@/components/ui/dialog';

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
  ariaLabel: string;
}) {
  const openedAt = useRef(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const requestClose = useModalLayer(open, onClose, panelRef);

  useEffect(() => {
    if (open) openedAt.current = performance.now();
  }, [open]);

  if (typeof document === 'undefined' || !open) return null;

  return createPortal(
    <div
      className="bg-scrim fixed inset-0 z-50 flex flex-col justify-end"
      onPointerDown={(e) => {
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
      }}
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        if (performance.now() - openedAt.current < BACKDROP_DISMISS_GRACE_MS) return;
        requestClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        tabIndex={-1}
        className={cn(
          'bg-background shadow-lifted flex max-h-[90svh] w-full flex-col overflow-y-auto rounded-t-2xl border-t',
          'pb-safe',
          className,
        )}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
