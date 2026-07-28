import type { ElementType, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * The uppercase micro-label used for section eyebrows, status badges, table
 * headers and date dividers.
 *
 * This replaces 17 hand-written variants that had drifted across 5 font sizes
 * (8/9/10/11px), 6 letter-spacings and 4 font weights. The design language
 * sanctions exactly one: 10px / bold / +0.13em / uppercase.
 */

const TONE = {
  muted: 'text-muted-foreground',
  signal: 'bg-signal/20 text-signal-foreground dark:text-signal',
  secondary: 'bg-secondary text-secondary-foreground',
  outline: 'border-border border',
  danger: 'bg-destructive/15 text-destructive-ink',
  positive: 'bg-positive/20 text-positive-ink',
} as const;

export type EyebrowTone = keyof typeof TONE;

export function Eyebrow({
  as: Tag = 'p',
  tone = 'muted',
  variant = 'plain',
  mono = false,
  icon,
  className,
  children,
  ...rest
}: {
  as?: ElementType;
  tone?: EyebrowTone;
  /** `chip` adds a filled/bordered pill background; `plain` is bare text. */
  variant?: 'plain' | 'chip';
  mono?: boolean;
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
} & Omit<React.HTMLAttributes<HTMLElement>, 'children' | 'className'>) {
  return (
    <Tag
      className={cn(
        'text-[10px] font-bold tracking-[0.13em] uppercase',
        mono && 'font-mono',
        variant === 'chip' && 'inline-flex items-center gap-1.5 rounded-md px-2 py-1',
        variant === 'plain' && tone === 'muted' && TONE.muted,
        variant === 'chip' && TONE[tone],
        variant === 'plain' && tone !== 'muted' && TONE[tone],
        '[&_svg]:size-3 [&_svg]:shrink-0',
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </Tag>
  );
}
