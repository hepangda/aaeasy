import { useLocale, useTranslations } from 'use-intl';
import { LedgerMemberAvatar } from '@/components/ledger/member-avatar';
import { Card, CardHeader } from '@/components/ui/card';
import { Eyebrow } from '@/components/ui/eyebrow';
import { toneForAmount } from '@/components/ui/amount-row';
import { formatMoney } from '@aaeasy/core/money';
import { cn } from '@/lib/utils';
import type { HydratedLedger, LedgerMember } from '@/spa/types';

const TONE_CLASS = {
  positive: 'text-positive-ink',
  negative: 'text-destructive-ink',
  neutral: 'text-foreground',
  danger: 'text-destructive-ink',
  muted: 'text-muted-foreground',
} as const;

/**
 * Per-member balances.
 *
 * This used to render the same data twice — a `sm:hidden` card list and a
 * `min-w-[42rem]` table — which had two consequences worth calling out:
 *
 *  1. The table overflowed horizontally between 640–671px with no scroll
 *     affordance, orphaning the numbers from the member-name column.
 *  2. The two trees had drifted apart: the mobile list showed only a single
 *     net figure, so phone users could not see the pre/post settlement pair
 *     the desktop table exposed. That is a data-parity bug, not a style one.
 *
 * One tree now serves every width. Below `md` each member is a stacked block;
 * at `md` and up the same blocks lay out as aligned columns via a shared grid
 * template, so nothing scrolls sideways and nothing is hidden.
 */
export function LedgerSummaryTable({
  summary,
  members,
  currency,
  hasSettlementEntries,
}: {
  summary: HydratedLedger['summary'];
  members: LedgerMember[];
  currency: string;
  hasSettlementEntries: boolean;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const memberById = new Map(members.map((member) => [member.id, member]));

  // 4 or 5 columns depending on whether settlements have been recorded.
  const grid = hasSettlementEntries
    ? 'md:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))]'
    : 'md:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))]';

  return (
    <Card>
      <CardHeader eyebrow={<Eyebrow mono>{currency}</Eyebrow>} title={t('summary.title')} />

      {/* Column headers: only meaningful once the rows align as a grid. */}
      <div
        aria-hidden="true"
        className={cn(
          'bg-muted/55 border-border text-muted-foreground hidden border-b px-5 py-2.5 sm:px-6 md:grid md:gap-4',
          grid,
        )}
      >
        <Eyebrow as="span">{t('summary.member')}</Eyebrow>
        <Eyebrow as="span" className="text-right">
          {t('summary.paid')}
        </Eyebrow>
        <Eyebrow as="span" className="text-right">
          {t('summary.owed')}
        </Eyebrow>
        <Eyebrow as="span" className="text-right">
          {hasSettlementEntries ? t('settlements.before') : t('summary.net')}
        </Eyebrow>
        {hasSettlementEntries && (
          <Eyebrow as="span" className="text-right">
            {t('settlements.current')}
          </Eyebrow>
        )}
      </div>

      <ul className="divide-border divide-y">
        {summary.map((row) => {
          const member = memberById.get(row.memberId);
          const net = row.netMinorInGroup;
          const adjusted = row.adjustedNetMinorInGroup;

          return (
            <li
              key={row.memberId}
              className={cn(
                'hover:bg-muted/25 grid gap-3 px-5 py-4 transition-colors sm:px-6 md:items-center md:gap-4',
                grid,
              )}
            >
              <div className="flex min-w-0 items-center gap-2.5 font-semibold">
                {member ? <LedgerMemberAvatar member={member} size="sm" /> : null}
                <span className="truncate text-sm">{member?.displayName ?? '?'}</span>
              </div>

              <Figure
                label={t('summary.paid')}
                value={formatMoney(row.paidMinorInGroup, currency, locale)}
              />
              <Figure
                label={t('summary.owed')}
                value={formatMoney(row.owedMinorInGroup, currency, locale)}
              />
              <Figure
                label={hasSettlementEntries ? t('settlements.before') : t('summary.net')}
                value={formatMoney(net, currency, locale)}
                tone={toneForAmount(net)}
                emphasis
              />
              {hasSettlementEntries && (
                <Figure
                  label={t('settlements.current')}
                  value={formatMoney(adjusted, currency, locale)}
                  tone={toneForAmount(adjusted)}
                  emphasis
                />
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/**
 * One figure. Carries its own label below `md` (where there is no column
 * header to inherit meaning from) and drops it once the grid aligns.
 */
function Figure({
  label,
  value,
  tone = 'neutral',
  emphasis = false,
}: {
  label: string;
  value: string;
  tone?: keyof typeof TONE_CLASS;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 md:block md:text-right">
      <span className="text-muted-foreground text-xs md:hidden">{label}</span>
      <span
        className={cn(
          'font-mono text-sm tabular-nums',
          emphasis ? 'font-bold' : 'font-semibold',
          TONE_CLASS[tone],
        )}
      >
        {value}
      </span>
    </div>
  );
}
