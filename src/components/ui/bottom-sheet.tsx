import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { useModalLayer } from '@/components/ui/dialog';
import { useDragToDismiss } from '@/hooks/use-drag-to-dismiss';
import { usePresence } from '@/hooks/use-presence';
import { useReducedMotion } from '@/hooks/use-spring';

const BACKDROP_DISMISS_GRACE_MS = 200;
const EXIT_MS = 260;

/**
 * A bottom-anchored sheet you can actually grab.
 *
 * Three things this does that a plain `open && <div/>` cannot:
 *
 *  - **It arrives and leaves along the same path.** Entering from the bottom
 *    and then simply disappearing tells the user nothing about where the sheet
 *    went; travelling back down the way it came does.
 *  - **It follows the finger 1:1, and respects the throw.** Dismissal is
 *    decided by where the gesture is *heading* (velocity projection), not where
 *    the finger stopped, and the closing animation begins at the finger's exact
 *    speed so there is no seam between dragging and animating.
 *  - **The scrim tracks the drag continuously.** Dimming is a readout of how
 *    far along the dismissal is, which is what lets the user judge — mid-drag —
 *    whether to commit or pull back.
 */
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
  const scrimRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const { mounted, state } = usePresence(open, reducedMotion ? 160 : EXIT_MS);
  const requestClose = useModalLayer(mounted, onClose, panelRef);

  const { handlers, progress, dragging } = useDragToDismiss(panelRef, {
    onDismiss: onClose,
    disabled: reducedMotion,
  });

  useEffect(() => {
    if (open) openedAt.current = performance.now();
  }, [open]);

  // The scrim is written directly rather than through React state: it updates
  // on every pointermove during a drag, and a re-render per frame for one
  // opacity value is waste.
  useEffect(() => {
    const scrim = scrimRef.current;
    if (!scrim) return;
    scrim.style.opacity = state === 'present' ? String(1 - progress) : '0';
  }, [progress, state]);

  if (typeof document === 'undefined' || !mounted) return null;

  const offscreen = state !== 'present';

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end"
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
        ref={scrimRef}
        aria-hidden="true"
        className="bg-scrim absolute inset-0 transition-opacity duration-200 ease-out"
        style={{ opacity: offscreen ? 0 : 1 }}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        tabIndex={-1}
        {...handlers}
        className={cn(
          'bg-background shadow-lifted relative flex max-h-[90svh] w-full flex-col overflow-y-auto rounded-t-2xl border-t',
          'material-edge-top touch-pan-y',
          'pb-safe',
          // While the finger is down the surface *is* the finger — no
          // transition may sit between them. The spring takes over on release.
          !dragging && 'transition-transform duration-[260ms] ease-[cubic-bezier(0.22,1,0.36,1)]',
          'motion-reduce:transition-none',
          className,
        )}
        style={{ transform: offscreen ? 'translate3d(0, 100%, 0)' : undefined }}
      >
        {/* The grabber is the affordance: it is what tells a first-time user
            this surface can be pulled. Decorative to assistive tech — Escape
            and the backdrop already expose dismissal semantically. */}
        <div aria-hidden="true" className="flex shrink-0 justify-center pt-2 pb-1">
          <span className="bg-muted-foreground/30 h-1 w-9 rounded-full" />
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
