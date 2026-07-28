import type { ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * The single sanctioned empty state. Previously this component existed but was
 * imported in exactly one place, while the rest of the app hand-rolled two
 * other treatments (a centered icon block and a dashed-border paragraph copied
 * verbatim across 3+ files).
 *
 * `compact` is for empties nested inside a card or list, where the full
 * page-level treatment would be too heavy — it renders without the card shell
 * and demotes the heading.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  compact = false,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
}) {
  const iconPlate = icon && (
    <div
      className={cn(
        'border-primary/15 bg-secondary text-secondary-foreground grid shrink-0 place-items-center rounded-lg border',
        compact ? 'size-9 [&_svg]:size-4' : 'size-10 [&_svg]:size-4.5',
      )}
    >
      {icon}
    </div>
  );

  if (compact) {
    return (
      <div
        className={cn(
          'flex min-h-40 flex-col items-center justify-center gap-3 px-6 py-8 text-center',
          className,
        )}
      >
        {iconPlate}
        <p className="text-foreground text-sm font-semibold">{title}</p>
        {description && (
          <p className="text-muted-foreground max-w-sm text-xs leading-5">{description}</p>
        )}
        {action && <div className="mt-1">{action}</div>}
      </div>
    );
  }

  return (
    <Card
      className={cn(
        'flex flex-col gap-7 px-6 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-8 sm:py-9',
        className,
      )}
    >
      <div className="flex max-w-2xl items-start gap-4 sm:gap-5">
        {iconPlate}
        <div className="flex flex-col gap-2">
          <h2 className="text-foreground text-xl leading-tight font-bold tracking-[-0.025em] sm:text-2xl">
            {title}
          </h2>
          {description && (
            <p className="text-muted-foreground max-w-xl text-sm leading-6">{description}</p>
          )}
        </div>
      </div>
      {action && <div className="w-full shrink-0 sm:w-auto">{action}</div>}
    </Card>
  );
}
