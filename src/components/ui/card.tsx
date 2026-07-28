import type { ElementType, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * The canonical card shell. Replaces 13 hand-rolled variants that had drifted
 * across 3 radii, 3 shadow treatments and 5 padding scales.
 *
 * Structure mirrors the homepage `LedgerPreview` reference:
 *
 *     <Card>                       rounded-2xl border, no shadow
 *       <CardHeader … />           border-b px-5 py-5 sm:px-6
 *       <CardBody>…</CardBody>     p-5 sm:p-6
 *     </Card>
 *
 * Cards are delineated by their border, never a shadow — `shadow-lifted` is
 * reserved for genuinely floating surfaces (dialogs, sheets, popovers).
 */

const TONE = {
  default: 'border-border bg-card',
  danger: 'border-destructive/30 bg-card',
  inverted: 'bg-ledger text-ledger-foreground border-ledger-foreground/10 shadow-lifted',
  sunken: 'border-border bg-sunken',
} as const;

export type CardTone = keyof typeof TONE;

export function Card({
  as: Tag = 'section',
  tone = 'default',
  padding = 'none',
  className,
  children,
  ...rest
}: {
  as?: ElementType;
  tone?: CardTone;
  /**
   * `none` (default) expects `CardHeader`/`CardBody` children to own their own
   * insets — required whenever the card contains a bordered header or a
   * `divide-y` list, since padding on the shell would break the full-bleed
   * dividers. `body` applies the standard body padding directly for simple
   * single-block cards.
   */
  padding?: 'none' | 'body';
  className?: string;
  children: ReactNode;
} & Omit<React.HTMLAttributes<HTMLElement>, 'children' | 'className'>) {
  return (
    <Tag
      className={cn(
        'overflow-hidden rounded-2xl border',
        TONE[tone],
        padding === 'body' && 'p-5 sm:p-6',
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}

export function CardHeader({
  icon,
  eyebrow,
  title,
  description,
  action,
  className,
  children,
}: {
  icon?: ReactNode;
  eyebrow?: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  /** Right-aligned slot: a button, avatar stack, count chip, or overflow menu. */
  action?: ReactNode;
  className?: string;
  /** Escape hatch for headers that need a bespoke inner layout. */
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        'border-border flex items-center justify-between gap-4 border-b px-5 py-5 sm:px-6',
        className,
      )}
    >
      {children ?? (
        <>
          <div className="flex min-w-0 items-center gap-3">
            {icon && (
              <span className="bg-secondary text-primary-ink grid size-9 shrink-0 place-items-center rounded-lg [&_svg]:size-4">
                {icon}
              </span>
            )}
            <div className="flex min-w-0 flex-col gap-0.5">
              {eyebrow}
              {title && (
                <p className="truncate text-sm font-bold tracking-[-0.025em] sm:text-base">
                  {title}
                </p>
              )}
              {description && (
                <p className="text-muted-foreground truncate text-xs leading-5">{description}</p>
              )}
            </div>
          </div>
          {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
        </>
      )}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('p-5 sm:p-6', className)}>{children}</div>;
}
