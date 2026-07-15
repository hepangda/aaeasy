import { cn } from '@/lib/utils';

interface BrandMarkProps {
  className?: string;
  iconClassName?: string;
  showWordmark?: boolean;
}

export function BrandMark({ className, iconClassName, showWordmark = true }: BrandMarkProps) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2.5', className)}>
      <svg
        viewBox="0 0 48 48"
        aria-hidden="true"
        className={cn('size-9 shrink-0 drop-shadow-md', iconClassName)}
      >
        <g transform="rotate(-4 24 24)">
          <path
            d="M10 4.5h20.8l9.7 9.5v23.4a6.1 6.1 0 0 1-6.1 6.1H10a6.5 6.5 0 0 1-6.5-6.5V11A6.5 6.5 0 0 1 10 4.5Z"
            style={{ fill: 'var(--primary)' }}
          />
          <path d="M30.8 4.5v6.2a3.3 3.3 0 0 0 3.3 3.3h6.4Z" fill="white" opacity="0.26" />
          <path
            d="M11.5 10.5v27"
            fill="none"
            stroke="white"
            strokeLinecap="round"
            strokeWidth="2"
            opacity="0.2"
          />
          <path
            d="M16.5 20.2 32 17.7M16.5 29.2l10.7-1.8"
            fill="none"
            strokeLinecap="round"
            strokeWidth="4.2"
            style={{ stroke: 'var(--signal)' }}
          />
        </g>
      </svg>
      {showWordmark ? (
        <span className="font-display text-foreground truncate text-lg font-black tracking-[-0.045em]">
          AA<span className="text-primary-ink">Easy</span>
        </span>
      ) : (
        <span className="sr-only">AAEasy</span>
      )}
    </span>
  );
}
