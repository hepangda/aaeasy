import { useCallback, useEffect, useId, useLayoutEffect, useRef, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useDragToDismiss } from '@/hooks/use-drag-to-dismiss';
import { useMediaQuery } from '@/hooks/use-media-query';
import { usePresence } from '@/hooks/use-presence';
import { useReducedMotion } from '@/hooks/use-spring';

const BACKDROP_DISMISS_GRACE_MS = 200;
const DIALOG_EXIT_MS = 240;
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

interface ModalLayer {
  id: symbol;
  getPanel: () => HTMLElement | null;
  /** Whether this layer contributes to the body scroll lock. */
  locksScroll: boolean;
}

const modalLayers: ModalLayer[] = [];
let bodyOverflowBeforeLock = '';
let bodyPaddingRightBeforeLock = '';
let rootRestoreTarget: HTMLElement | null = null;

function topModalLayer(): ModalLayer | undefined {
  return modalLayers[modalLayers.length - 1];
}

function lockingLayerCount(): number {
  return modalLayers.filter((layer) => layer.locksScroll).length;
}

function registerModalLayer(layer: ModalLayer, restoreTarget: HTMLElement | null): void {
  const isFirstLock = layer.locksScroll && lockingLayerCount() === 0;
  if (modalLayers.length === 0) rootRestoreTarget = restoreTarget;
  modalLayers.push(layer);
  if (!layer.locksScroll) return;

  if (isFirstLock) {
    bodyOverflowBeforeLock = document.body.style.overflow;
    bodyPaddingRightBeforeLock = document.body.style.paddingRight;

    // Hiding overflow removes the scrollbar, which widens the viewport by its
    // thickness and shifts every centred element sideways. Replace it with
    // padding so the layout doesn't move. Overlay scrollbars report 0 here and
    // correctly get no padding.
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    if (scrollbarWidth > 0) {
      const current = parseFloat(window.getComputedStyle(document.body).paddingRight) || 0;
      document.body.style.paddingRight = `${current + scrollbarWidth}px`;
    }
  }
  document.body.style.overflow = 'hidden';
}

function unregisterModalLayer(id: symbol): HTMLElement | null {
  const index = modalLayers.findIndex((layer) => layer.id === id);
  const removed = index >= 0 ? modalLayers[index] : undefined;
  if (index >= 0) modalLayers.splice(index, 1);

  // Only release the lock once the last *locking* layer is gone; a popover
  // layered over a dialog must not unfreeze the page behind it.
  if (!removed?.locksScroll || lockingLayerCount() > 0) {
    return modalLayers.length === 0 ? takeRestoreTarget() : null;
  }

  document.body.style.overflow = bodyOverflowBeforeLock;
  document.body.style.paddingRight = bodyPaddingRightBeforeLock;
  return takeRestoreTarget();
}

function takeRestoreTarget(): HTMLElement | null {
  const target = rootRestoreTarget;
  rootRestoreTarget = null;
  return target;
}

function focusableElements(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) =>
      element.getClientRects().length > 0 &&
      !element.closest('[aria-hidden="true"], [inert]') &&
      !('disabled' in element && Boolean(element.disabled)),
  );
}

function focusPanel(panel: HTMLElement): void {
  const focusable = focusableElements(panel);
  (focusable[0] ?? panel).focus();
}

/**
 * Shared modal behaviour: Escape, focus trapping, focus restore, and (for true
 * modals) a body scroll lock.
 *
 * `lockScroll: false` suits transient popovers like a select listbox. Freezing
 * the page for a dropdown is heavy-handed, and the lock's own side effect —
 * removing the scrollbar — visibly shifts the layout underneath.
 */
export function useModalLayer<T extends HTMLElement>(
  open: boolean,
  onClose: () => void,
  panelRef: RefObject<T | null>,
  { lockScroll = true }: { lockScroll?: boolean } = {},
): () => void {
  const layerId = useRef(Symbol('modal-layer'));
  const onCloseRef = useRef(onClose);
  const wasOpenRef = useRef(false);
  const focusBeforeOpenRef = useRef<HTMLElement | null>(null);

  // Capture the trigger during render, before a descendant with autoFocus is
  // mounted in the portal. `wasOpenRef` only advances after commit so an
  // interrupted render cannot consume the transition.
  if (typeof document !== 'undefined' && open && !wasOpenRef.current) {
    const active = document.activeElement;
    if (active instanceof HTMLElement && !panelRef.current?.contains(active)) {
      focusBeforeOpenRef.current = active;
    }
  }

  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useLayoutEffect(() => {
    wasOpenRef.current = open;
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const id = layerId.current;
    const focusBeforeOpen =
      focusBeforeOpenRef.current ?? (document.activeElement as HTMLElement | null);
    const layer: ModalLayer = { id, getPanel: () => panelRef.current, locksScroll: lockScroll };
    registerModalLayer(layer, focusBeforeOpen);

    function onKeyDown(event: KeyboardEvent) {
      if (topModalLayer()?.id !== id || event.defaultPrevented) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const panel = panelRef.current;
      if (!panel) return;
      const focusable = focusableElements(panel);
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;
      if (!panel.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    queueMicrotask(() => {
      const panel = panelRef.current;
      if (!panel || topModalLayer()?.id !== id || panel.contains(document.activeElement)) return;
      focusPanel(panel);
    });

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      const rootTarget = unregisterModalLayer(id);
      queueMicrotask(() => {
        const topLayer = topModalLayer();
        const topPanel = topLayer?.getPanel();
        if (topPanel) {
          if (focusBeforeOpen?.isConnected && topPanel.contains(focusBeforeOpen)) {
            focusBeforeOpen.focus();
          } else if (!topPanel.contains(document.activeElement)) {
            focusPanel(topPanel);
          }
          return;
        }
        if (rootTarget?.isConnected) rootTarget.focus();
      });
    };
  }, [open, panelRef, lockScroll]);

  return useCallback(() => {
    if (topModalLayer()?.id === layerId.current) onCloseRef.current();
  }, []);
}

/**
 * Modal dialog with a backdrop. Renders into `document.body` via a portal so
 * it escapes any ancestor `overflow:hidden` / transform stack.
 *
 * On mobile (< sm) it docks to the bottom as a sheet — easier for one-handed
 * use than a top-anchored card — and can be dragged down to dismiss. On `sm+`
 * it floats centered and *materializes*: blur and scale animate together so the
 * surface reads as a real pane of glass arriving, rather than a flat rectangle
 * fading in. Both directions retrace the same path, so a dialog always leaves
 * the way it came.
 *
 * Closes on backdrop click and Escape; body scroll is locked while open.
 */
export function Dialog({
  open,
  onClose,
  title,
  ariaLabel,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  ariaLabel?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const t = useTranslations('common');
  const openedAt = useRef(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const reducedMotion = useReducedMotion();
  const isCompact = useMediaQuery('(max-width: 639px)');
  const { mounted, state } = usePresence(open, reducedMotion ? 160 : DIALOG_EXIT_MS);
  const requestClose = useModalLayer(mounted, onClose, panelRef);

  // Drag-to-dismiss only earns its place on the bottom-docked mobile
  // presentation. A centered desktop card has no edge to pull toward.
  const { handlers, progress, dragging } = useDragToDismiss(panelRef, {
    onDismiss: onClose,
    disabled: reducedMotion || !isCompact,
  });

  useEffect(() => {
    if (open) openedAt.current = performance.now();
  }, [open]);

  useEffect(() => {
    const scrim = scrimRef.current;
    if (!scrim) return;
    scrim.style.opacity = state === 'present' ? String(1 - progress) : '0';
  }, [progress, state]);

  if (typeof document === 'undefined' || !mounted) return null;

  const offscreen = state !== 'present';
  // Reduced motion keeps the cross-fade and drops the travel: a large surface
  // sweeping across the viewport is exactly the motion that causes trouble.
  const enterTransform = reducedMotion
    ? undefined
    : isCompact
      ? 'translate3d(0, 100%, 0)'
      : 'scale(0.94) translate3d(0, 8px, 0)';

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:overflow-y-auto sm:p-4"
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
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : ariaLabel}
        tabIndex={-1}
        {...handlers}
        className={cn(
          'bg-background shadow-lifted relative flex w-full max-w-lg flex-col gap-4 border p-5',
          'max-h-[90svh] overflow-y-auto rounded-t-2xl rounded-b-none border-b-0',
          'sm:max-h-[calc(100svh-2rem)] sm:rounded-2xl sm:border-b',
          'material-edge-top touch-pan-y sm:touch-auto',
          'pb-safe-5',
          !dragging &&
            'transition-[transform,opacity] duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)]',
          'motion-reduce:transition-opacity',
          className,
        )}
        style={{
          transform: offscreen ? enterTransform : undefined,
          opacity: offscreen && (reducedMotion || !isCompact) ? 0 : undefined,
        }}
      >
        {/* Mobile only: the sheet is draggable there, so it says so. */}
        <div aria-hidden="true" className="-mt-2 flex shrink-0 justify-center pb-1 sm:hidden">
          <span className="bg-muted-foreground/30 h-1 w-9 rounded-full" />
        </div>
        {title && (
          <header className="flex items-center justify-between gap-2">
            <h2 id={titleId} className="text-base font-bold">
              {title}
            </h2>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="-mr-1"
              onClick={requestClose}
              aria-label={t('close')}
            >
              <X aria-hidden="true" />
            </Button>
          </header>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}
