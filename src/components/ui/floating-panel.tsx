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
  role?: 'dialog' | 'region';
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
  children,
}: FloatingPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Re-position whenever the anchor moves (scroll, layout shift, etc.).
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
      setCoords({ top, left });
    }
    update();
    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    resizeObserver?.observe(anchor);
    if (panelRef.current) resizeObserver?.observe(panelRef.current);
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
      resizeObserver?.disconnect();
    };
  }, [open, anchor, align, gap]);

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

  if (!mounted || !open) return null;

  return createPortal(
    <div
      ref={panelRef}
      style={{
        position: 'absolute',
        top: coords?.top ?? -9999,
        left: coords?.left ?? -9999,
        visibility: coords ? 'visible' : 'hidden',
      }}
      className={cn('z-50', className)}
      role={role}
      aria-label={ariaLabel}
    >
      {children}
    </div>,
    document.body,
  );
}
