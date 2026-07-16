import { ArrowRightLeft, Check } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { cn } from '@/lib/utils';

export function SettlementStatus({ pendingTransfers }: { pendingTransfers: number }) {
  const t = useTranslations();
  const settled = pendingTransfers === 0;

  return (
    <section className="bg-ledger text-ledger-foreground shadow-lifted flex items-center gap-4 rounded-2xl px-5 py-5 sm:gap-5 sm:px-7 sm:py-6">
      <span
        className={cn(
          'grid size-11 shrink-0 place-items-center rounded-full',
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
        <h2 className="text-xl leading-tight font-semibold tracking-[-0.03em] sm:text-2xl">
          {settled
            ? t('summary.trail_title_even')
            : t('summary.trail_title_pending', { count: pendingTransfers })}
        </h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-white/60">
          {settled ? t('summary.trail_desc') : t('settlements.pending_desc')}
        </p>
      </div>
    </section>
  );
}
