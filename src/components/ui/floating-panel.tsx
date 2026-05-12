'use client';

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
      // Position so the panel sits below the anchor.
      const top = r.bottom + gap + window.scrollY;
      let left: number;
      if (align === 'end') {
        left = r.right - pw + window.scrollX;
      } else {
        left = r.left + window.scrollX;
      }
      // Clamp horizontally to viewport with a small inset.
      const inset = 8;
      const maxLeft = window.scrollX + window.innerWidth - pw - inset;
      const minLeft = window.scrollX + inset;
      left = Math.max(minLeft, Math.min(left, maxLeft));
      setCoords({ top, left });
    }
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open, anchor, align, gap]);

  // Click-outside + Escape handling.
  useEffect(() => {
    if (!open || !onClose) return;
    function onPointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (anchor?.contains(target)) return;
      onClose?.();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose?.();
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
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
      role="dialog"
    >
      {children}
    </div>,
    document.body,
  );
}
