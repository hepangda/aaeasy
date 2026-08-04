import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

export interface FloatingPanelProps {
  open: boolean;
  anchor: HTMLElement | null;
  onClose?: () => void;
  /** 'start' = align to anchor's left, 'end' = right. */
  align?: 'start' | 'end';
  /** Pixel gap between anchor and panel. */
  gap?: number;
  className?: string;
  ariaLabel: string;
  role?: 'dialog' | 'region' | 'listbox';
  /** Match the anchor's width — for panels that read as part of the control. */
  matchAnchorWidth?: boolean;
  /** Extra props for the panel element — keyboard handlers, ARIA wiring. */
  panelProps?: React.HTMLAttributes<HTMLDivElement>;
  /** Access the panel element, e.g. to move focus into it. */
  panelRef?: React.Ref<HTMLDivElement>;
  children: React.ReactNode;
}

/**
 * Renders a positioned panel into `document.body` so it escapes ancestor
 * `overflow:hidden`/`overflow-x-auto` containers — which would otherwise
 * trigger spurious horizontal scrollbars when the panel extends past the
 * container edge.
 *
 * Positions itself relative to `anchor.getBoundingClientRect()` and updates
 * on scroll/resize. We deliberately don't auto-flip; callers can choose
 * `align` based on context.
 */
export function FloatingPanel({
  open,
  anchor,
  onClose,
  align = 'end',
  gap = 4,
  className,
  ariaLabel,
  role = 'dialog',
  matchAnchorWidth = false,
  panelProps,
  panelRef: externalPanelRef,
  children,
}: FloatingPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{
    top: number;
    left: number;
    width?: number;
    /** Null until the panel has been measured — see `update()`. */
    origin: { x: number; y: number };
    /** False for the single commit before the panel exists to be measured. */
    measured: boolean;
  } | null>(null);
  const [mounted, setMounted] = useState(false);
  // The positioning pass, owned by the effect below but needed by the panel's
  // callback ref — which fires in the same commit, before that effect has a
  // node to measure.
  const updateRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Re-position whenever the anchor moves (scroll, layout shift, etc.).
  //
  // Note this cannot measure the panel on its first run: the portal renders in
  // the same commit, so on the initial open the panel node does not exist yet
  // and `origin` comes back null. The callback ref below re-runs `update()` the
  // moment the node attaches, which is still before paint — so the panel is
  // never seen unpositioned, and the entrance animation plays once, from the
  // correct origin.
  useLayoutEffect(() => {
    if (!open || !anchor) {
      setCoords(null);
      return;
    }
    function update() {
      if (!anchor) return;
      const r = anchor.getBoundingClientRect();
      const panel = panelRef.current;
      const pw = panel?.offsetWidth ?? 0;
      const ph = panel?.offsetHeight ?? 0;
      const inset = 8;
      const belowTop = r.bottom + gap;
      const aboveTop = r.top - gap - ph;
      const viewportTop =
        belowTop + ph <= window.innerHeight - inset ? belowTop : Math.max(inset, aboveTop);
      const top = viewportTop + window.scrollY;
      let left: number;
      if (align === 'end') {
        left = r.right - pw + window.scrollX;
      } else {
        left = r.left + window.scrollX;
      }
      // Clamp horizontally to viewport with a small inset.
      const maxLeft = window.scrollX + window.innerWidth - pw - inset;
      const minLeft = window.scrollX + inset;
      left = Math.max(minLeft, Math.min(left, maxLeft));
      // A zero width means the anchor hasn't been laid out yet; pinning the
      // panel to it would render an invisible sliver.
      const width = matchAnchorWidth && r.width > 0 ? r.width : undefined;

      // Where the panel should appear to grow *from*. A popover that scales out
      // of its own centre floats free of whatever opened it; anchoring the
      // origin to the trigger keeps the relationship between control and
      // content legible, and tells the user where it will collapse back to.
      //
      // This needs the panel's own dimensions, which do not exist on the first
      // pass — the portal renders in the same commit that runs this effect, so
      // the very first `update()` has no node to measure and leaves the panel
      // parked at the off-screen fallback position. The panel's callback ref
      // re-runs `update()` the instant the node attaches, still before paint.
      // "Measured" means the panel node existed when this ran — not that it
      // reported a non-zero size. Those differ: a genuinely zero-size panel is
      // still correctly positioned and must still paint, whereas a panel that
      // does not exist yet leaves `top`/`left` at the off-screen fallback. Only
      // the latter must be withheld from the screen.
      const measured = panel !== null;
      const origin = {
        x: Math.min(Math.max(r.left + r.width / 2 - (left - window.scrollX), 0), pw),
        // Grow downward from the top edge when the panel sits below its
        // trigger, and upward from the bottom edge when it was flipped above —
        // either way, out of the edge nearest the control.
        y: viewportTop >= r.bottom ? 0 : ph,
      };
      // Bail out when nothing actually moved. `update()` runs from a callback
      // ref that fires on every render, so unconditionally setting a fresh
      // object here would re-render, re-fire the ref, and loop forever.
      setCoords((previous) => {
        if (
          previous &&
          previous.top === top &&
          previous.left === left &&
          previous.width === width &&
          previous.origin.x === origin.x &&
          previous.origin.y === origin.y &&
          previous.measured === measured
        ) {
          return previous;
        }
        return { top, left, width, origin, measured };
      });
    }
    update();
    updateRef.current = update;
    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    resizeObserver?.observe(anchor);
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      updateRef.current = null;
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
      resizeObserver?.disconnect();
    };
  }, [open, anchor, align, gap, matchAnchorWidth]);

  // Click-outside + Escape handling.
  useEffect(() => {
    if (!open || !onClose) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (anchor?.contains(target)) return;
      onClose?.();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose?.();
    }
    // `pointerdown` rather than `mousedown`: the latter is not dispatched for
    // touch input in every browser, so tapping outside the panel on a phone
    // could leave it stuck open.
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, anchor, onClose]);

  // Nothing is rendered until the panel has been positioned. Rendering it
  // hidden-but-present would let the entrance animation run while invisible, so
  // the user would catch it halfway through — the panel appeared to fade in
  // from a strange partial state instead of growing cleanly out of its trigger.
  //
  // The first pass measures the anchor only (the panel does not exist yet, so
  // `origin` is still null); the frame after, it re-measures with real
  // dimensions. Both happen before paint, so this costs no visible delay.
  if (!mounted || !open) return null;

  return createPortal(
    <div
      ref={(node) => {
        panelRef.current = node;
        if (typeof externalPanelRef === 'function') externalPanelRef(node);
        else if (externalPanelRef) externalPanelRef.current = node;
        // The node has just landed, in the same commit that ran the positioning
        // effect — which therefore measured a panel that did not exist and left
        // `origin` null. Re-measure now. This is still before paint, so the
        // panel is never shown unpositioned and the entrance plays exactly once
        // from the right origin.
        //
        // Deliberately *not* observed for resize. ResizeObserver reports the
        // border box, which the entrance animation scales every frame: the
        // panel would re-measure itself mid-flight, recompute its own top and
        // origin from a box that is still growing, and visibly slide while
        // fading in. Anchor moves and viewport changes are covered by the
        // scroll/resize listeners instead.
        if (node) updateRef.current?.();
      }}
      style={{
        position: 'absolute',
        // Once `coords` exists these are always real numbers; the fallbacks
        // only cover the single pre-measurement commit, during which the panel
        // is also hidden and unanimated (see `data-measured`).
        top: coords?.top ?? -9999,
        left: coords?.left ?? -9999,
        width: coords?.width,
        // Hidden until measured. This is not just cosmetic: the entrance
        // animation is a *transition of the element's own box*, so if it starts
        // while `top` is still the -9999 fallback, the panel spends its whole
        // fade travelling thousands of pixels up the page into position. That
        // long diagonal slide was the "strange fade" — not the opacity curve.
        visibility: coords?.measured ? 'visible' : 'hidden',
        transformOrigin: coords ? `${coords.origin.x}px ${coords.origin.y}px` : undefined,
      }}
      // Drives the entrance animation. Both the origin and the animation start
      // on the same commit, so the panel grows out of its trigger in one
      // uninterrupted pass — previously the animation class appeared a frame
      // before the origin did, restarting the animation mid-flight and reading
      // as an odd double fade.
      data-measured={coords?.measured ? 'true' : undefined}
      className={cn(
        'z-50',
        // A positioned element must never *transition* its own position.
        // `duration-150`/`ease-out` on their own compile to `transition: all`,
        // which includes `top` and `left` — so the panel eased across the ten
        // thousand pixels between its off-screen fallback and its real place,
        // and read as flying in from outside the viewport. Pinning the
        // transition to `none` leaves the entrance entirely to the keyframe
        // animation below, which only touches transform and opacity.
        'transition-none',
        // Materialize from the trigger: scale and fade together so the panel
        // reads as a surface arriving out of the control, rather than a
        // rectangle that was always there and merely became visible.
        //
        // Keyed off `data-measured` so the animation and the transform origin
        // turn on in the same commit — applying the animation a frame before
        // the origin restarted it mid-flight and read as a double fade. The
        // duration/easing are scoped to the same attribute so they can never
        // apply on their own.
        'data-[measured]:motion-safe:animate-in data-[measured]:motion-safe:fade-in-0',
        'data-[measured]:motion-safe:zoom-in-95',
        'data-[measured]:motion-safe:duration-150 data-[measured]:motion-safe:ease-out',
        className,
      )}
      role={role}
      aria-label={ariaLabel}
      {...panelProps}
    >
      {children}
    </div>,
    document.body,
  );
}
