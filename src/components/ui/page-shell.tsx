import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * The outer shell every routed page sits in.
 *
 * Page containers used to be hand-written, and eleven of them had drifted to
 * five different max-widths (3xl/4xl/5xl/6xl/7xl), three padding ramps and four
 * gap values — so the content column visibly jumped when navigating between
 * pages, and none of them lined up with the header bar above.
 *
 * `default` matches the header's own container exactly, so the brand mark, the
 * page title and the content below share one left edge. `narrow` is for pages
 * that are a single focused form, where a full-width measure would strand the
 * fields across a very long line.
 */
export function PageShell({
  width = 'default',
  className,
  children,
}: {
  width?: 'default' | 'narrow';
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex w-full flex-1">
      <div
        className={cn(
          'mx-auto flex w-full flex-1 flex-col gap-7 px-4 py-7 sm:gap-9 sm:px-6 sm:py-10 lg:px-8',
          width === 'narrow' ? 'max-w-3xl' : 'max-w-6xl',
          className,
        )}
      >
        {children}
      </div>
    </section>
  );
}
