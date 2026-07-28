import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';

/**
 * Announce SPA navigations to assistive tech and reset focus to the top of the
 * new page.
 *
 * Without this, a route change leaves focus wherever the activated link was and
 * says nothing — a screen-reader user has no signal that the page changed, and
 * keyboard users resume tabbing from a stale position.
 *
 * The initial render is skipped: the browser already announces a full page load.
 */
export function useRouteAnnouncer(mainId: string) {
  const { pathname } = useLocation();
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    const main = document.getElementById(mainId);
    if (!main) return;

    // `tabIndex={-1}` on <main> makes this focusable without adding it to the
    // tab order. preventScroll because the router already handles scroll
    // restoration; stealing it here would fight that.
    main.focus({ preventScroll: true });
  }, [mainId, pathname]);
}
