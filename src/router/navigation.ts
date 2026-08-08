import { useMemo } from 'react';
import { useLocation, useNavigate, useSearchParams as useRouterSearchParams } from 'react-router';

/**
 * Client-side navigation.
 *
 * There is deliberately no `refresh()` here. Mutations declare which caches
 * they invalidate (see `actionRequest`), so a blanket "refetch everything"
 * only ever hid a missing declaration behind a pile of redundant requests.
 */
export function useRouter() {
  const navigate = useNavigate();
  return useMemo(
    () => ({
      push(href: string) {
        navigate(href);
      },
      replace(href: string) {
        navigate(href, { replace: true });
      },
    }),
    [navigate],
  );
}

export function usePathname(): string {
  return useLocation().pathname;
}

export function useSearchParams(): URLSearchParams {
  return useRouterSearchParams()[0];
}
