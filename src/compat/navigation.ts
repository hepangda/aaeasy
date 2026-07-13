import { useMemo } from 'react';
import { useLocation, useNavigate, useSearchParams as useRouterSearchParams } from 'react-router';
import { refreshQueries } from '@/spa/query-client';

export function useRouter() {
  const navigate = useNavigate();
  return useMemo(
    () => ({
      push(href: string, _options?: { scroll?: boolean }) {
        navigate(href);
      },
      replace(href: string) {
        navigate(href, { replace: true });
      },
      back() {
        navigate(-1);
      },
      refresh() {
        refreshQueries();
      },
      prefetch() {
        return Promise.resolve();
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

export function redirect(href: string): never {
  window.location.replace(href);
  throw new Error('REDIRECT');
}

export function notFound(): never {
  window.location.replace('/404');
  throw new Error('NOT_FOUND');
}
