import { useRef, useState } from 'react';
import { useTranslations } from 'use-intl';
import type { SplitClass } from '@aaeasy/core/split-classify';
import { FloatingPanel } from '@/components/ui/floating-panel';

export interface SharePill {
  memberId: string;
  memberName: string;
  amountText: string;
  isPayer: boolean;
}

/**
 * Compact split label ("均分" / "比例" / ...) that reveals the per-member
 * breakdown when activated.
 *
 * The label itself is the control — it previously sat next to a separate 32px
 * info button, which put an interactive chrome element in the middle of a quiet
 * metadata line. It also inherits its type size from the parent rather than
 * hard-coding `text-sm`, which made it larger than the row it lived in.
 */
export function SplitBadge({
  kind,
  shares,
  interactive = true,
}: {
  kind: SplitClass;
  shares: SharePill[];
  /**
   * Set to `false` where the badge sits inside a larger control (a row that is
   * itself a menu trigger) — a nested button there would be both invalid
   * markup and an ambiguous tap target.
   */
  interactive?: boolean;
}) {
  const t = useTranslations('expenses');
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);

  const labelKey = `split_class_${kind.toLowerCase()}` as const;

  const label = t(labelKey);

  if (!interactive || shares.length === 0) {
    return <span className="whitespace-nowrap">{label}</span>;
  }

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t('show_split_details')}
        aria-expanded={open}
        className="hover:text-foreground inline-flex items-center gap-1 whitespace-nowrap underline decoration-dotted underline-offset-2 transition-colors"
      >
        {label}
      </button>
      <FloatingPanel
        open={open && shares.length > 0}
        anchor={anchorRef.current}
        onClose={() => setOpen(false)}
        align="start"
        className="w-48"
        role="region"
        ariaLabel={t('show_split_details')}
      >
        <div className="bg-popover shadow-lifted rounded-md border p-2">
          <ul className="flex flex-col gap-0.5 text-xs">
            {shares.map((s) => (
              <li
                key={s.memberId}
                className={`flex items-center justify-between gap-3 rounded-md px-1.5 py-1 ${
                  s.isPayer ? 'bg-primary/10' : ''
                }`}
              >
                <span className="font-semibold">{s.memberName}</span>
                <span className="font-mono tabular-nums">{s.amountText}</span>
              </li>
            ))}
          </ul>
        </div>
      </FloatingPanel>
    </>
  );
}
