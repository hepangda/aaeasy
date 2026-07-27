import { cn } from '@/lib/utils';

interface BrandMarkProps {
  className?: string;
  iconClassName?: string;
  showWordmark?: boolean;
}

export function BrandMark({ className, iconClassName, showWordmark = true }: BrandMarkProps) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2.5', className)}>
      <svg viewBox="0 0 48 48" aria-hidden="true" className={cn('size-8 shrink-0', iconClassName)}>
        <path
          d="M9 4h21l10 10v25a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9a5 5 0 0 1 5-5Z"
          style={{ fill: 'var(--primary)' }}
        />
        <path d="M30 4v7a3 3 0 0 0 3 3h7Z" fill="white" opacity="0.24" />
        <path
          d="M14 19h18M14 27h14"
          fill="none"
          stroke="white"
          strokeLinecap="square"
          strokeWidth="2.8"
        />
        <path
          d="M14 35h7"
          fill="none"
          strokeLinecap="square"
          strokeWidth="3.4"
          style={{ stroke: 'var(--signal)' }}
        />
      </svg>
      {showWordmark ? (
        <span className="font-display truncate text-base font-bold tracking-[-0.045em] text-current">
          AA<span className="text-primary-ink">Easy</span>
        </span>
      ) : (
        <span className="sr-only">AAEasy</span>
      )}
    </span>
  );
}
