import { useCallback, useEffect, useRef, useState } from 'react';
import {
  SPRING,
  isSpringAtRest,
  stepSpring,
  type SpringConfig,
  type SpringState,
} from '@/lib/motion/springs';

/**
 * A spring you can drive imperatively, without re-rendering on every frame.
 *
 * The returned `value` is a ref, not state: 60–120 React renders per second for
 * a transform is waste, and reading the live value from a ref is also what
 * interruption needs (see below). Subscribe with `onFrame` to write the value
 * into the DOM.
 *
 * Two properties matter more than the maths:
 *
 *  - **It animates from the presentation value.** Re-targeting mid-flight
 *    continues from wherever the value actually is on screen, so grabbing a
 *    moving element never produces a jump.
 *  - **It carries velocity through a re-target.** Reversing direction blends
 *    the existing velocity instead of hard-cutting it to zero, which is what
 *    otherwise makes a reversal feel like hitting a brick wall.
 */
export function useSpringValue(
  initial: number,
  onFrame: (value: number) => void,
  config: SpringConfig = SPRING.ui,
) {
  const stateRef = useRef<SpringState>({ value: initial, velocity: 0 });
  const targetRef = useRef(initial);
  const configRef = useRef(config);
  const frameRef = useRef<number | null>(null);
  const lastTimeRef = useRef(0);
  const onFrameRef = useRef(onFrame);
  const restCallbackRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    onFrameRef.current = onFrame;
  });

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  const stop = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
  }, []);

  const tick = useCallback((time: number) => {
    const delta = lastTimeRef.current === 0 ? 1 / 60 : (time - lastTimeRef.current) / 1000;
    lastTimeRef.current = time;

    const next = stepSpring(stateRef.current, targetRef.current, configRef.current, delta);
    stateRef.current = next;

    if (isSpringAtRest(next, targetRef.current)) {
      stateRef.current = { value: targetRef.current, velocity: 0 };
      onFrameRef.current(targetRef.current);
      frameRef.current = null;
      const done = restCallbackRef.current;
      restCallbackRef.current = null;
      done?.();
      return;
    }

    onFrameRef.current(next.value);
    frameRef.current = requestAnimationFrame(tick);
  }, []);

  const start = useCallback(() => {
    if (frameRef.current !== null) return;
    lastTimeRef.current = 0;
    frameRef.current = requestAnimationFrame(tick);
  }, [tick]);

  /**
   * Point the spring at a new target. Safe to call mid-flight — the current
   * value and velocity are preserved, which is exactly what interruption and
   * reversal need.
   */
  const animateTo = useCallback(
    (
      target: number,
      options: { velocity?: number; config?: SpringConfig; onRest?: () => void } = {},
    ) => {
      targetRef.current = target;
      if (options.config) configRef.current = options.config;
      if (options.velocity !== undefined) stateRef.current.velocity = options.velocity;
      restCallbackRef.current = options.onRest ?? null;
      if (isSpringAtRest(stateRef.current, target)) {
        stateRef.current = { value: target, velocity: 0 };
        onFrameRef.current(target);
        options.onRest?.();
        return;
      }
      start();
    },
    [start],
  );

  /** Jump to a value with no animation — for 1:1 gesture tracking. */
  const set = useCallback(
    (value: number, velocity = 0) => {
      stop();
      stateRef.current = { value, velocity };
      targetRef.current = value;
      onFrameRef.current(value);
    },
    [stop],
  );

  useEffect(() => stop, [stop]);

  return {
    animateTo,
    set,
    stop,
    /** The live on-screen value. Read this on interrupt, never the target. */
    current: () => stateRef.current.value,
    velocity: () => stateRef.current.velocity,
  };
}

/**
 * Accessibility preferences that change *behaviour*, not just styling.
 *
 * A Tailwind `motion-reduce:` variant can drop a transition, but it cannot make
 * a component skip an entrance animation, or make a drag-to-dismiss sheet close
 * without travelling. Those decisions live in JS, so the preferences have to be
 * readable there.
 */
function usePreference(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const media = window.matchMedia(query);
    setMatches(media.matches);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/**
 * Reduced motion does not mean *no* feedback — it means a gentler,
 * non-vestibular equivalent. Callers should cross-fade instead of sliding, and
 * drop overshoot, but keep the opacity and colour changes that tell the user
 * something happened.
 */
export function useReducedMotion(): boolean {
  return usePreference('(prefers-reduced-motion: reduce)');
}

/** When true, translucent surfaces should become frosty/solid rather than blurred. */
export function useReducedTransparency(): boolean {
  return usePreference('(prefers-reduced-transparency: reduce)');
}
