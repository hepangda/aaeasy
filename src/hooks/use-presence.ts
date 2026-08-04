import { useEffect, useRef, useState } from 'react';

export type PresenceState = 'entering' | 'present' | 'exiting';

/**
 * Keeps a surface mounted long enough to animate out.
 *
 * Every modal in this app used to render as `open && <Panel/>`, which meant
 * dismissal was a hard cut: the surface was simply gone on the next frame. That
 * breaks spatial continuity — if something arrives along a path, it has to
 * leave along that same path, or the user loses track of where it went and how
 * to get it back.
 *
 * Returns `null` while closed, and otherwise a phase the caller maps to a
 * transform. The exit phase is held for `duration` before unmounting.
 */
export function usePresence(
  open: boolean,
  duration = 260,
): { mounted: boolean; state: PresenceState } {
  const [mounted, setMounted] = useState(open);
  const [state, setState] = useState<PresenceState>(open ? 'present' : 'exiting');
  const frameRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    if (timerRef.current !== null) clearTimeout(timerRef.current);

    if (open) {
      setMounted(true);
      // Mount at the entering offset first, then flip on the next frame so the
      // browser has an "old" value to transition from. Setting both in one
      // paint produces no animation at all.
      setState('entering');
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = requestAnimationFrame(() => setState('present'));
      });
      return;
    }

    if (!mounted) return;
    setState('exiting');
    timerRef.current = setTimeout(() => setMounted(false), duration);

    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
    // `mounted` is read but must not retrigger this effect: doing so would
    // restart the exit timer every time the exit itself changes state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, duration]);

  return { mounted, state };
}
