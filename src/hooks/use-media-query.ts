import { useEffect, useState } from 'react';

/**
 * Subscribes to a CSS media query.
 *
 * Used where a breakpoint changes *behaviour* rather than styling — a Tailwind
 * `md:` class can hide an element, but it cannot turn a row into a menu
 * trigger. Starts as `false` so the first paint matches the server-agnostic
 * desktop layout, then corrects on mount.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(query);
    setMatches(media.matches);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
