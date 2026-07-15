import { ArrowRight, Check } from 'lucide-react';
import { useLocale, useTranslations } from 'use-intl';
import Link from '@/compat/link';
import type { HydratedLedger, LedgerMember } from '@/spa/types';
import { formatMoney } from '@/lib/money';
import { LedgerMemberAvatar, ledgerMemberColor } from '@/components/ledger/member-avatar';

const MAX_VISIBLE_TRANSFERS = 3;
const MAX_VISIBLE_BALANCES = 3;

export function BalanceTrail({
  members,
  summary,
  transfers,
  currency,
}: {
  members: LedgerMember[];
  summary: HydratedLedger['summary'];
  transfers: HydratedLedger['transfers'];
  currency: string;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const memberById = new Map(members.map((member) => [member.id, member]));
  const nonZeroBalances = summary.filter((row) => row.adjustedNetMinorInGroup !== 0n);
  const visibleBalances = nonZeroBalances.slice(0, MAX_VISIBLE_BALANCES);
  const visibleTransfers = transfers.slice(0, MAX_VISIBLE_TRANSFERS);
  const remainingTransfers = transfers.length - visibleTransfers.length;

  return (
    <section className="bg-ledger text-ledger-foreground shadow-lifted relative isolate overflow-hidden rounded-2xl sm:rounded-[1.75rem]">
      <div
        aria-hidden
        className="absolute inset-0 -z-10 opacity-90"
        style={{
          background:
            'radial-gradient(circle at 12% 40%, color-mix(in oklab, var(--signal) 16%, transparent) 0 18%, transparent 18.5%), radial-gradient(circle at 28% 40%, color-mix(in oklab, var(--positive) 11%, transparent) 0 27%, transparent 27.5%), linear-gradient(135deg, color-mix(in oklab, var(--ledger-foreground) 4%, transparent), transparent 50%)',
        }}
      />

      <div className="grid gap-5 px-4 py-5 sm:min-h-72 sm:gap-8 sm:px-8 sm:py-9 lg:grid-cols-[minmax(15rem,0.72fr)_minmax(0,1.28fr)] lg:items-center lg:px-10">
        <div className="flex flex-col items-start gap-4 sm:gap-5">
          {transfers.length > 0 ? (
            <>
              <div>
                <p className="text-[11px] font-semibold tracking-[0.16em] text-white/50 uppercase">
                  {t('summary.title')}
                </p>
                <h2 className="mt-2 max-w-xs text-2xl leading-tight font-semibold tracking-[-0.035em]">
                  {t('summary.trail_title_pending', { count: transfers.length })}
                </h2>
              </div>

              {visibleBalances.length > 0 ? (
                <ul className="hidden w-full gap-2 text-xs sm:grid">
                  {visibleBalances.map((row) => {
                    const member = memberById.get(row.memberId);
                    if (!member) return null;
                    const amount = row.adjustedNetMinorInGroup;
                    return (
                      <li key={row.memberId} className="flex items-center gap-2.5 text-white/75">
                        <span
                          className="size-1.5 shrink-0 rounded-full"
                          style={{ backgroundColor: ledgerMemberColor(member) }}
                        />
                        <span className="min-w-0 flex-1 truncate">{member.displayName}</span>
                        <span className="text-white/45">
                          {amount > 0n ? t('summary.to_receive') : t('summary.to_pay')}
                        </span>
                        <span className="font-mono text-white tabular-nums">
                          {formatMoney(amount < 0n ? -amount : amount, currency, locale)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : null}

              <Link
                href="#transfers"
                className="bg-signal text-signal-foreground focus-visible:ring-offset-ledger hover:bg-signal/90 inline-flex min-h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold shadow-sm transition-colors focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:outline-hidden"
              >
                {t('summary.open_transfers')}
                <ArrowRight className="size-4" />
              </Link>
            </>
          ) : (
            <>
              <span className="bg-positive text-positive-foreground ring-positive/10 grid size-12 place-items-center rounded-full shadow-sm ring-8">
                <Check className="size-6" strokeWidth={2.5} />
              </span>
              <div>
                <p className="text-[11px] font-semibold tracking-[0.16em] text-white/50 uppercase">
                  {t('summary.title')}
                </p>
                <h2 className="mt-2 text-3xl font-semibold tracking-[-0.035em]">
                  {t('summary.trail_title_even')}
                </h2>
                <p className="mt-2 max-w-sm text-sm leading-relaxed text-white/60">
                  {t('summary.trail_desc')}
                </p>
              </div>
            </>
          )}
        </div>

        <div className="rounded-xl border border-white/10 bg-black/10 p-2.5 sm:rounded-2xl sm:p-4">
          {visibleTransfers.length > 0 ? (
            <ul className="grid gap-2.5">
              {visibleTransfers.map((transfer, index) => {
                const from = memberById.get(transfer.from);
                const to = memberById.get(transfer.to);
                if (!from || !to) return null;
                const trailColor = ledgerMemberColor(from);
                return (
                  <li
                    key={`${transfer.from}-${transfer.to}-${index}`}
                    className="grid grid-cols-[minmax(0,0.8fr)_minmax(5.5rem,1.15fr)_minmax(0,0.8fr)] items-center gap-2 rounded-lg bg-white/[0.035] px-2.5 py-2.5 sm:rounded-xl sm:px-3 sm:py-3"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <LedgerMemberAvatar member={from} size="sm" className="border-white/25" />
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold">{from.displayName}</p>
                        <p className="truncate text-[10px] text-white/45">{t('summary.to_pay')}</p>
                      </div>
                    </div>

                    <div className="relative flex min-w-0 items-center justify-center px-1">
                      <span
                        aria-hidden
                        className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 opacity-90"
                        style={{ backgroundColor: trailColor }}
                      />
                      <span
                        aria-hidden
                        className="absolute top-1/2 right-0 size-2 -translate-y-1/2 rotate-45 border-t border-r"
                        style={{ borderColor: trailColor }}
                      />
                      <span className="bg-ledger relative rounded-full border border-white/10 px-2.5 py-1 font-mono text-[10px] font-semibold whitespace-nowrap text-white tabular-nums shadow-lg sm:text-xs">
                        {formatMoney(transfer.amountMinor, currency, locale)}
                      </span>
                    </div>

                    <div className="flex min-w-0 items-center justify-end gap-2 text-right">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold">{to.displayName}</p>
                        <p className="truncate text-[10px] text-white/45">
                          {t('summary.to_receive')}
                        </p>
                      </div>
                      <LedgerMemberAvatar member={to} size="sm" className="border-white/25" />
                    </div>
                  </li>
                );
              })}
              {remainingTransfers > 0 ? (
                <li className="px-3 py-1 text-center text-xs text-white/45">
                  +{remainingTransfers} · {t('summary.transfers_title')}
                </li>
              ) : null}
            </ul>
          ) : (
            <div className="flex min-h-44 flex-col items-center justify-center gap-4 text-center">
              <div className="flex -space-x-2">
                {members.slice(0, 6).map((member) => (
                  <LedgerMemberAvatar
                    key={member.id}
                    member={member}
                    size="lg"
                    className="border-ledger"
                  />
                ))}
              </div>
              <p className="max-w-sm text-sm text-white/55">{t('summary.transfers_empty')}</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
