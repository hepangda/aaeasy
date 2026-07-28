import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * The canonical "label on the left, money on the right" list row.
 *
 * Beyond deduplicating 6 hand-written variants, this centralizes two rules the
 * ad-hoc copies kept getting wrong:
 *
 *  - Amounts are `font-mono` so digits align in a column.
 *  - Owed-vs-owing is never signalled by colour alone. `tone` drives both the
 *    ink colour *and* a sign glyph, so the semantic survives colour blindness
 *    and monochrome rendering.
 */

const TONE = {
  neutral: 'text-foreground',
  positive: 'text-positive-ink',
  negative: 'text-primary-ink',
  danger: 'text-destructive-ink',
  muted: 'text-muted-foreground',
} as const;

export type AmountTone = keyof typeof TONE;

/**
 * Derive a tone from a signed amount. Callers holding a bigint/number should
 * use this rather than hand-picking colours at each site.
 */
export function toneForAmount(amount: bigint | number): AmountTone {
  const zero = typeof amount === 'bigint' ? 0n : 0;
  if (amount > zero) return 'positive';
  if (amount < zero) return 'negative';
  return 'muted';
}

export function AmountRow({
  label,
  sublabel,
  leading,
  amount,
  tone = 'neutral',
  trailing,
  className,
}: {
  label: ReactNode;
  /** Secondary line under the label — payer, date, note. */
  sublabel?: ReactNode;
  /** Avatar or icon plate before the label. */
  leading?: ReactNode;
  amount: ReactNode;
  tone?: AmountTone;
  /** Slot after the amount — an action button or chevron. */
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'border-border flex items-center justify-between gap-4 border-b py-3 last:border-b-0',
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        {leading}
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-xs">{label}</span>
          {sublabel && (
            <span className="text-muted-foreground truncate text-xs leading-5">{sublabel}</span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className={cn('font-mono text-xs font-bold whitespace-nowrap', TONE[tone])}>
          {amount}
        </span>
        {trailing}
      </div>
    </div>
  );
}
