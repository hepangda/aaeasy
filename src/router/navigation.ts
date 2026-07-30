import { useMemo } from 'react';
import { useLocation, useNavigate, useSearchParams as useRouterSearchParams } from 'react-router';
import { refreshQueries } from '@/spa/query-client';

export function useRouter() {
  const navigate = useNavigate();
  return useMemo(
    () => ({
      push(href: string) {
        navigate(href);
      },
      refresh() {
        refreshQueries();
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
