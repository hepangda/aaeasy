'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Info } from 'lucide-react';
import type { SplitClass } from '@/lib/split/classify';
import { FloatingPanel } from '@/components/ui/floating-panel';

export interface SharePill {
  memberId: string;
  memberName: string;
  amountText: string;
  isPayer: boolean;
}

/**
 * Compact label ("均分" / "比例" / "特殊" / "单人支付") + an info icon that,
 * on hover or click, reveals the per-member share breakdown in a portal so
 * the popover doesn't trip the table's `overflow-x-auto`.
 */
export function SplitBadge({
  kind,
  shares,
}: {
  kind: SplitClass;
  shares: SharePill[];
}) {
  const t = useTranslations('expenses');
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);

  const labelKey = `split_class_${kind.toLowerCase()}` as const;

  return (
    <span
      className="inline-flex items-center gap-1"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span className="text-sm">{t(labelKey)}</span>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t('show_split_details')}
        aria-expanded={open}
        className="text-muted-foreground hover:text-foreground inline-flex"
      >
        <Info className="size-3.5" />
      </button>
      <FloatingPanel
        open={open && shares.length > 0}
        anchor={anchorRef.current}
        onClose={() => setOpen(false)}
        align="start"
        className="w-48"
      >
        <div className="bg-popover rounded-md border p-2 shadow-md">
          <ul className="flex flex-col gap-0.5 text-xs">
            {shares.map((s) => (
              <li
                key={s.memberId}
                className={`flex items-center justify-between gap-3 rounded px-1.5 py-1 ${
                  s.isPayer ? 'bg-primary/10' : ''
                }`}
              >
                <span className="font-medium">{s.memberName}</span>
                <span className="font-mono tabular-nums">{s.amountText}</span>
              </li>
            ))}
          </ul>
        </div>
      </FloatingPanel>
    </span>
  );
}
