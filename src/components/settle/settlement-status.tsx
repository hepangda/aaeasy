import { ArrowRightLeft, Check } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export function SettlementStatus({ pendingTransfers }: { pendingTransfers: number }) {
  const t = useTranslations();
  const settled = pendingTransfers === 0;

  return (
    <Card
      tone="inverted"
      as="section"
      className="flex items-center gap-4 px-5 py-5 sm:gap-5 sm:px-6"
    >
      <span
        className={cn(
          'grid size-10 shrink-0 place-items-center rounded-lg',
          settled ? 'bg-positive text-positive-foreground' : 'bg-signal text-signal-foreground',
        )}
      >
        {settled ? (
          <Check className="size-5" aria-hidden="true" />
        ) : (
          <ArrowRightLeft className="size-5" aria-hidden="true" />
        )}
      </span>
      <div className="min-w-0">
        <h2 className="font-display text-lg leading-tight font-semibold tracking-[-0.04em] sm:text-xl">
          {settled
            ? t('summary.trail_title_even')
            : t('summary.trail_title_pending', { count: pendingTransfers })}
        </h2>
        <p className="text-ledger-foreground/60 mt-1 max-w-2xl text-sm leading-relaxed">
          {settled ? t('summary.trail_desc') : t('settlements.pending_desc')}
        </p>
      </div>
    </Card>
  );
}
