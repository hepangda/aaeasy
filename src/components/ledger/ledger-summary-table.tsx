import { useLocale, useTranslations } from 'use-intl';
import { LedgerMemberAvatar } from '@/components/ledger/member-avatar';
import { formatMoney } from '@/lib/money';
import type { HydratedLedger, LedgerMember } from '@/spa/types';

function balanceTone(value: bigint): string {
  if (value > 0n) return 'text-positive-ink';
  if (value < 0n) return 'text-destructive-ink';
  return 'text-muted-foreground';
}

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

  return (
    <section className="bg-card overflow-hidden rounded-xl border">
      <header className="border-b px-4 py-4 sm:px-5">
        <p className="text-muted-foreground font-mono text-[9px] font-semibold tracking-[0.15em] uppercase">
          {currency}
        </p>
        <h2 className="mt-1 text-base font-semibold tracking-[-0.02em]">{t('summary.title')}</h2>
      </header>
      <ul className="divide-y sm:hidden">
        {summary.map((row) => {
          const member = memberById.get(row.memberId);
          const current = hasSettlementEntries ? row.adjustedNetMinorInGroup : row.netMinorInGroup;
          return (
            <li key={row.memberId} className="grid gap-3 px-4 py-4">
              <div className="flex min-w-0 items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2.5 font-medium">
                  {member ? <LedgerMemberAvatar member={member} size="sm" /> : null}
                  <span className="truncate">{member?.displayName ?? '?'}</span>
                </div>
                <span className={`font-mono font-semibold tabular-nums ${balanceTone(current)}`}>
                  {formatMoney(current, currency, locale)}
                </span>
              </div>
              <dl className="text-muted-foreground grid grid-cols-2 gap-3 text-xs">
                <div>
                  <dt>{t('summary.paid')}</dt>
                  <dd className="text-foreground mt-0.5 font-mono tabular-nums">
                    {formatMoney(row.paidMinorInGroup, currency, locale)}
                  </dd>
                </div>
                <div>
                  <dt>{t('summary.owed')}</dt>
                  <dd className="text-foreground mt-0.5 font-mono tabular-nums">
                    {formatMoney(row.owedMinorInGroup, currency, locale)}
                  </dd>
                </div>
              </dl>
            </li>
          );
        })}
      </ul>
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[42rem] text-sm">
          <thead className="bg-muted/55 text-muted-foreground font-mono text-[10px] tracking-[0.04em] uppercase">
            <tr>
              <th className="px-4 py-3 text-left font-medium sm:px-5">{t('summary.member')}</th>
              <th className="px-3 py-3 text-right font-medium">{t('summary.paid')}</th>
              <th className="px-3 py-3 text-right font-medium">{t('summary.owed')}</th>
              <th className="px-3 py-3 text-right font-medium">
                {hasSettlementEntries ? t('settlements.before') : t('summary.net')}
              </th>
              {hasSettlementEntries ? (
                <th className="px-4 py-3 text-right font-medium sm:px-5">
                  {t('settlements.current')}
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody className="divide-y">
            {summary.map((row) => {
              const member = memberById.get(row.memberId);
              return (
                <tr key={row.memberId} className="hover:bg-muted/25 transition-colors">
                  <td className="px-4 py-3 sm:px-5">
                    <div className="flex items-center gap-2.5 font-medium">
                      {member ? <LedgerMemberAvatar member={member} size="sm" /> : null}
                      <span>{member?.displayName ?? '?'}</span>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right font-mono tabular-nums">
                    {formatMoney(row.paidMinorInGroup, currency, locale)}
                  </td>
                  <td className="px-3 py-3 text-right font-mono tabular-nums">
                    {formatMoney(row.owedMinorInGroup, currency, locale)}
                  </td>
                  <td
                    className={`px-3 py-3 text-right font-mono font-semibold tabular-nums ${balanceTone(row.netMinorInGroup)}`}
                  >
                    {formatMoney(row.netMinorInGroup, currency, locale)}
                  </td>
                  {hasSettlementEntries ? (
                    <td
                      className={`px-4 py-3 text-right font-mono font-semibold tabular-nums sm:px-5 ${balanceTone(row.adjustedNetMinorInGroup)}`}
                    >
                      {formatMoney(row.adjustedNetMinorInGroup, currency, locale)}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
