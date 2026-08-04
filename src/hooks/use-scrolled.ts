import { useEffect, useState } from 'react';

/**
 * Whether the page has scrolled past a small threshold.
 *
 * Used to decide when floating chrome needs separation from the content. A
 * divider drawn permanently under a sticky header separates the header from
 * nothing at all when the page is at rest — it is a line the design pays for
 * and the user gets no information from. The separation should appear only
 * where floating UI actually overlaps content.
 */
export function useScrolled(threshold = 8): boolean {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    let frame: number | null = null;
    const read = () => {
      frame = null;
      setScrolled(window.scrollY > threshold);
    };
    const onScroll = () => {
      // Coalesce to one read per frame: scroll fires far more often than the
      // display refreshes, and each handler here does a layout-reading access.
      if (frame === null) frame = requestAnimationFrame(read);
    };

    read();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [threshold]);

  return scrolled;
}
