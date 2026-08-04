import { useCallback, useRef, useState } from 'react';
import { useReducedMotion } from '@/hooks/use-spring';

export interface PressableOptions {
  /** How far the surface compresses. Large surfaces need less. */
  scale?: number;
  disabled?: boolean;
}

/**
 * Press feedback that happens the instant the pointer goes down.
 *
 * Waiting for `click` — which fires on release — is the single most common way
 * an interface feels dead. The moment lag appears between a touch and its
 * acknowledgement, the sense of direct manipulation falls off a cliff, and on
 * touch devices `click` can trail `pointerdown` by well over 100ms.
 *
 * The gesture is also cancellable the way a real button is: dragging off the
 * target releases the press (you changed your mind), and dragging back on
 * re-engages it. That forgiveness is why physical buttons let you slide your
 * finger away to abort.
 */
export function usePressable({ scale = 0.97, disabled = false }: PressableOptions = {}) {
  const [pressed, setPressed] = useState(false);
  const pointerIdRef = useRef<number | null>(null);
  // An inline style outranks any `motion-reduce:` class, so the preference has
  // to be honoured here rather than in the class string. Reduced motion still
  // gets feedback — the browser's own :active styling and the colour change
  // remain — it just doesn't get the movement.
  const reducedMotion = useReducedMotion();

  const release = useCallback(() => {
    pointerIdRef.current = null;
    setPressed(false);
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (disabled || event.button !== 0) return;
      pointerIdRef.current = event.pointerId;
      setPressed(true);
    },
    [disabled],
  );

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (pointerIdRef.current !== event.pointerId) return;
    // Hit-testing against the element's own box with a small tolerance, so a
    // finger that drifts a few pixels during a tap does not abort it.
    const rect = event.currentTarget.getBoundingClientRect();
    const slop = 10;
    const inside =
      event.clientX >= rect.left - slop &&
      event.clientX <= rect.right + slop &&
      event.clientY >= rect.top - slop &&
      event.clientY <= rect.bottom + slop;
    setPressed(inside);
  }, []);

  return {
    pressed,
    pressProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: release,
      onPointerCancel: release,
      onPointerLeave: release,
    },
    /**
     * Both the transform *and* its transition live in the inline style.
     *
     * They cannot be split across a class and a style: `tailwind-merge` treats
     * `transition-transform` and the `transition-colors`/`transition-[…]` that
     * call sites already carry as one conflicting group and keeps only the
     * last, so whichever lost, the compression silently stopped animating.
     *
     * Because an inline `transition-property` replaces the class's outright,
     * this list has to carry the colour properties too — otherwise fixing the
     * press would break every hover on the same element. Transform is given a
     * shorter duration than colour: the press must feel immediate, while a
     * hover tint can afford to ease in.
     */
    pressStyle: {
      transform: pressed && !disabled && !reducedMotion ? `scale(${scale})` : undefined,
      transitionProperty: 'transform, color, background-color, border-color, box-shadow, opacity',
      transitionDuration: '100ms, 150ms, 150ms, 150ms, 150ms, 150ms',
      transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
    } as React.CSSProperties,
  };
}
