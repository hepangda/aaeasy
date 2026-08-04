import { useCallback, useEffect, useRef, useState } from 'react';
import { VelocityTracker, project, rubberband } from '@/lib/motion/springs';

export interface DragToDismissOptions {
  /** Called once the sheet has finished travelling off screen. */
  onDismiss: () => void;
  /** Fraction of the surface's height that counts as "far enough" to dismiss. */
  threshold?: number;
  /** Skip the gesture entirely (reduced motion, desktop, etc.). */
  disabled?: boolean;
}

export interface DragToDismissResult {
  /** Spread onto the draggable surface. */
  handlers: {
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  };
  /** 0 = fully presented, 1 = fully dismissed. Drives the scrim opacity. */
  progress: number;
  dragging: boolean;
}

/**
 * Drag-to-dismiss for a bottom-anchored surface.
 *
 * The three details that separate this from a "swipe down to close" listener:
 *
 *  1. **The surface tracks the finger 1:1**, from the offset where it was
 *     grabbed. It is never animating toward the finger, it *is* the finger.
 *  2. **Release velocity decides the outcome, and is handed to the spring.**
 *     Where the gesture is *going* matters more than where it stopped, so a
 *     small fast flick dismisses even from near the top; and because the spring
 *     starts at the finger's exact speed, there is no visible seam between
 *     dragging and animating.
 *  3. **It can be grabbed mid-flight.** Pointer-down during the settle
 *     animation reads the live on-screen offset and continues from there, so a
 *     sheet you catch on its way out follows your finger instead of finishing
 *     its exit first.
 *
 * The caller owns the DOM node so we can write transforms directly, without a
 * React render per frame.
 */
export function useDragToDismiss(
  surfaceRef: React.RefObject<HTMLElement | null>,
  { onDismiss, threshold = 0.35, disabled = false }: DragToDismissOptions,
): DragToDismissResult {
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState(0);

  const offsetRef = useRef(0);
  const grabOffsetRef = useRef(0);
  const heightRef = useRef(0);
  const trackerRef = useRef(new VelocityTracker());
  const frameRef = useRef<number | null>(null);
  const onDismissRef = useRef(onDismiss);
  // The gesture may start inside a scrollable region. We only take over the
  // pointer once the user has moved far enough to prove downward intent AND
  // that region is already at its top — otherwise we would steal their scroll.
  const claimedRef = useRef(false);
  const startYRef = useRef(0);
  const startXRef = useRef(0);
  const scrollerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  const paint = useCallback(
    (offset: number) => {
      const surface = surfaceRef.current;
      if (!surface) return;
      offsetRef.current = offset;
      surface.style.transform = offset === 0 ? '' : `translate3d(0, ${offset}px, 0)`;
      const height = heightRef.current || surface.offsetHeight || 1;
      setProgress(Math.min(1, Math.max(0, offset / height)));
    },
    [surfaceRef],
  );

  const stopFrame = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
  }, []);

  useEffect(() => stopFrame, [stopFrame]);

  /**
   * Settle to a target offset, starting at the release velocity.
   *
   * Spring integration lives inline rather than in `useSpringValue` because the
   * settle needs to both paint every frame and fire a terminal callback for the
   * dismiss case, and because interrupting it means reading `offsetRef` — the
   * presentation value — not a target.
   */
  const settle = useCallback(
    (target: number, velocity: number, done?: () => void) => {
      stopFrame();
      // Sheet spring: damping 0.8 / response 0.3. The slight underdamping is
      // earned — the user's own flick put the momentum there.
      const omega = (2 * Math.PI) / 0.3;
      const stiffness = omega * omega;
      const friction = 2 * 0.8 * omega;
      let value = offsetRef.current;
      let speed = velocity;
      let last = performance.now();

      const tick = (now: number) => {
        const delta = Math.min((now - last) / 1000, 1 / 30);
        last = now;
        let remaining = delta;
        while (remaining > 0) {
          const dt = Math.min(1 / 240, remaining);
          remaining -= dt;
          speed += (-stiffness * (value - target) - friction * speed) * dt;
          value += speed * dt;
        }

        if (Math.abs(value - target) < 0.5 && Math.abs(speed) < 5) {
          paint(target);
          frameRef.current = null;
          done?.();
          return;
        }
        paint(value);
        frameRef.current = requestAnimationFrame(tick);
      };

      frameRef.current = requestAnimationFrame(tick);
    },
    [paint, stopFrame],
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (disabled || event.button !== 0) return;
      const surface = surfaceRef.current;
      if (!surface) return;

      // Controls own their own gestures — a drag that starts on a button, a
      // text field or a slider is that control's, not the sheet's.
      const target = event.target as HTMLElement;
      if (target.closest('button, a, input, textarea, select, [role="slider"], [data-no-drag]')) {
        return;
      }

      // Interruption: whatever is on screen right now is where we continue
      // from. Reading the target instead would snap the sheet before the finger
      // had moved a pixel.
      stopFrame();

      heightRef.current = surface.offsetHeight;
      grabOffsetRef.current = offsetRef.current;
      startYRef.current = event.clientY;
      startXRef.current = event.clientX;
      claimedRef.current = false;
      scrollerRef.current = findScrollableAncestor(target, surface);
      trackerRef.current.reset(event.clientY, event.timeStamp);

      const pointerId = event.pointerId;

      const onMove = (moveEvent: PointerEvent) => {
        const travel = moveEvent.clientY - startYRef.current;
        trackerRef.current.add(moveEvent.clientY, moveEvent.timeStamp);

        if (!claimedRef.current) {
          // ~10px of hysteresis before committing to a direction, so a tap with
          // a shaky finger doesn't nudge the sheet. Both plausible gestures
          // (scroll the content, dismiss the sheet) are tracked from the first
          // move and the loser is dropped once intent is unambiguous.
          if (Math.abs(travel) < 10) return;
          // A mostly-horizontal swipe is somebody else's gesture.
          if (Math.abs(moveEvent.clientX - startXRef.current) > Math.abs(travel)) return;
          // Nothing above the presented position, so an upward drag from rest
          // is not a dismissal gesture at all.
          if (travel < 0 && offsetRef.current <= 0) return;
          // The content under the finger gets first claim on a downward drag
          // until it has nothing left to scroll.
          const scroller = scrollerRef.current;
          if (travel > 0 && scroller && scroller.scrollTop > 0) return;
          claimedRef.current = true;
          setDragging(true);
          surface.setPointerCapture(pointerId);
        }

        const raw = grabOffsetRef.current + travel;
        // Dragging *up* meets progressive resistance rather than a hard stop:
        // there is nothing above the presented position, and continuous
        // resistance communicates that far better than a frozen surface.
        const next =
          raw >= 0 ? raw : -rubberband(-raw, heightRef.current || surface.offsetHeight || 1);
        paint(next);
        moveEvent.preventDefault();
      };

      const onUp = (upEvent: PointerEvent) => {
        surface.removeEventListener('pointermove', onMove);
        surface.removeEventListener('pointerup', onUp);
        surface.removeEventListener('pointercancel', onUp);
        if (surface.hasPointerCapture(pointerId)) surface.releasePointerCapture(pointerId);
        if (!claimedRef.current) return;

        setDragging(false);
        const velocity = trackerRef.current.velocity(upEvent.timeStamp);
        const height = heightRef.current || surface.offsetHeight || 1;

        // Decide against the *projected* resting point, not the release point.
        // This is what makes a short fast flick throw the sheet closed instead
        // of springing it back because the finger happened to stop early.
        const projected = offsetRef.current + project(velocity);
        const shouldDismiss = projected > height * threshold;

        if (shouldDismiss) {
          settle(height, velocity, () => onDismissRef.current());
        } else {
          settle(0, velocity);
        }
      };

      surface.addEventListener('pointermove', onMove);
      surface.addEventListener('pointerup', onUp);
      surface.addEventListener('pointercancel', onUp);
    },
    [disabled, paint, settle, stopFrame, surfaceRef, threshold],
  );

  return { handlers: { onPointerDown }, progress, dragging };
}

/**
 * Nearest ancestor that actually scrolls, bounded by the sheet itself.
 *
 * Used to answer "is the content under the finger already at its top?" — the
 * question that decides whether a downward drag belongs to the list or to the
 * sheet.
 */
function findScrollableAncestor(from: HTMLElement, bound: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = from;
  while (node) {
    const style = getComputedStyle(node);
    const scrollable = /auto|scroll|overlay/.test(style.overflowY);
    if (scrollable && node.scrollHeight > node.clientHeight) return node;
    if (node === bound) return null;
    node = node.parentElement;
  }
  return null;
}
