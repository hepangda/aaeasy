import type { ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';
import Link from '@/router/link';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Page- and section-level headers.
 *
 * Replaces 4 competing page-header patterns (bordered, breadcrumbed,
 * back-buttoned, centered) and 18 ad-hoc section headings that used 3 different
 * h2 sizes. Display tracking is fixed at the two sanctioned values rather than
 * the 7 that had accumulated.
 */

export function PageHeader({
  title,
  description,
  eyebrow,
  badge,
  meta,
  backLink,
  action,
  divider = false,
  align = 'start',
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  /** Rendered inline after the title — archived/locked status and the like. */
  badge?: ReactNode;
  /** A row under the title: member stack, currency, counts. */
  meta?: ReactNode;
  backLink?: { href: string; label: ReactNode };
  action?: ReactNode;
  divider?: boolean;
  align?: 'start' | 'center';
  className?: string;
}) {
  const centered = align === 'center';

  return (
    <header
      className={cn(
        'flex flex-col gap-3',
        centered && 'items-center text-center',
        divider && 'border-border border-b pb-6 sm:pb-8',
        className,
      )}
    >
      {backLink && (
        <Button asChild variant="ghost" size="sm" className="-ml-3 self-start">
          <Link href={backLink.href}>
            <ChevronLeft aria-hidden="true" />
            <span className="truncate">{backLink.label}</span>
          </Link>
        </Button>
      )}

      <div
        className={cn(
          'flex flex-col gap-4',
          !centered && 'sm:flex-row sm:items-end sm:justify-between',
        )}
      >
        <div className={cn('flex min-w-0 flex-col gap-2', centered && 'items-center')}>
          {eyebrow}
          <div className="flex min-w-0 items-center gap-3">
            <h1 className="font-display text-foreground tracking-display truncate text-3xl leading-none font-bold sm:text-4xl">
              {title}
            </h1>
            {badge}
          </div>
          {description && (
            <p className="text-muted-foreground max-w-xl text-sm leading-6">{description}</p>
          )}
          {meta}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </header>
  );
}

export function SectionHeader({
  title,
  description,
  action,
  eyebrow,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  eyebrow?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-4', className)}>
      <div className="flex min-w-0 flex-col gap-1.5">
        {eyebrow}
        <h2 className="text-foreground tracking-title text-base font-bold">{title}</h2>
        {description && <p className="text-muted-foreground text-sm leading-6">{description}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}
