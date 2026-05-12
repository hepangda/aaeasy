'use client';

import { useMemo } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * URL-search-param-driven pagination control. The current page lives in
 * `?[paramKey]=N` (1-indexed, defaults to 1). Page changes preserve the URL
 * hash (which we use for active tab) and other search params.
 *
 * The parent component is responsible for slicing items based on the page;
 * see `getPageSlice` for a helper.
 */
export function Pagination({
  paramKey,
  totalItems,
  pageSize,
}: {
  paramKey: string;
  totalItems: number;
  pageSize: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const current = clamp(parseInt(params.get(paramKey) ?? '1', 10) || 1, 1, totalPages);

  const visibleNumbers = useMemo(
    () => buildPageWindow(current, totalPages),
    [current, totalPages],
  );

  if (totalPages <= 1) return null;

  function goto(page: number) {
    const next = new URLSearchParams(params.toString());
    if (page <= 1) next.delete(paramKey);
    else next.set(paramKey, String(page));
    const qs = next.toString();
    // Preserve the hash (tab state) so paginating doesn't kick the user to
    // a different tab.
    const hash = typeof window !== 'undefined' ? window.location.hash : '';
    router.push(`${pathname}${qs ? `?${qs}` : ''}${hash}`, { scroll: false });
  }

  return (
    <nav
      aria-label="Pagination"
      className="text-muted-foreground flex items-center justify-end gap-1 text-xs"
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8"
        disabled={current <= 1}
        onClick={() => goto(current - 1)}
        aria-label="Previous page"
      >
        <ChevronLeft />
      </Button>
      {visibleNumbers.map((p, i) =>
        p === '…' ? (
          <span key={`gap-${i}`} className="px-1">
            …
          </span>
        ) : (
          <Button
            key={p}
            type="button"
            variant={p === current ? 'default' : 'ghost'}
            size="icon"
            className="size-8 text-xs tabular-nums"
            onClick={() => goto(p)}
            aria-current={p === current ? 'page' : undefined}
          >
            {p}
          </Button>
        ),
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8"
        disabled={current >= totalPages}
        onClick={() => goto(current + 1)}
        aria-label="Next page"
      >
        <ChevronRight />
      </Button>
    </nav>
  );
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Compute a compact page-number sequence with ellipses for the control.
 * Examples (current/total): 1/10 → [1,2,3,…,10]; 5/10 → [1,…,4,5,6,…,10].
 */
function buildPageWindow(current: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: (number | '…')[] = [1];
  if (current > 3) out.push('…');
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) {
    out.push(i);
  }
  if (current < total - 2) out.push('…');
  out.push(total);
  return out;
}
