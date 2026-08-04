import { cn } from '@/lib/utils';

/**
 * Loading placeholders that preserve layout while data resolves.
 *
 * The app previously gated every page on a centered full-page spinner — often
 * twice in sequence (session, then page data) — so a mobile user on a slow
 * connection saw chrome → spinner → spinner → content, with the scroll position
 * jumping at each step. Skeletons hold the shape instead.
 */

export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        // Not Tailwind's `animate-pulse`: that swings opacity all the way to 0
        // on a 2s cycle, and a page of rows doing it in unison is the most
        // distracting thing on screen — right in the frequency band that reads
        // as demanding attention rather than reporting status. This breathes
        // shallowly (never below 0.45) and slower.
        'bg-muted skeleton-breathe block rounded-md motion-reduce:animate-none',
        className,
      )}
    />
  );
}

/** A skeleton shaped like the standard list row: label left, amount right. */
export function SkeletonRow() {
  return (
    <div className="border-border flex items-center justify-between gap-4 border-b py-3 last:border-b-0">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Skeleton className="size-9 shrink-0 rounded-lg" />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Skeleton className="h-3.5 w-2/5" />
          <Skeleton className="h-3 w-1/4" />
        </div>
      </div>
      <Skeleton className="h-4 w-16 shrink-0" />
    </div>
  );
}

export function SkeletonList({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div role="status" aria-busy="true" className={className}>
      {Array.from({ length: rows }, (_, i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  );
}

/** Page-level placeholder: a header block plus a list. */
export function SkeletonPage({ rows = 5 }: { rows?: number }) {
  return (
    <div
      role="status"
      aria-busy="true"
      className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-8"
    >
      <div className="flex flex-col gap-3">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-4 w-64" />
      </div>
      <div className="border-border bg-card overflow-hidden rounded-2xl border">
        <div className="border-border flex items-center justify-between border-b px-5 py-5 sm:px-6">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-12" />
        </div>
        <div className="px-5 sm:px-6">
          <SkeletonList rows={rows} />
        </div>
      </div>
    </div>
  );
}
