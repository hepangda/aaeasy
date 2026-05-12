/**
 * Common shape consumed by every exporter (CSV / Excel / PDF).
 *
 * It pulls the live ledger via `loadGroupLedger` and flattens the data into
 * primitive-typed rows ready for any sink. Money is exposed both as an
 * already-formatted string (for human-friendly display) and as a `number`
 * in **major units** (for spreadsheet math). BigInt cannot enter Excel/CSV
 * cleanly so we accept the mild precision risk for amounts that fit in a
 * Number safely (max safe int = ~9 quadrillion minor units = lots of dollars).
 */

import { loadGroupLedger } from '@/lib/expenses/queries';
import { formatMinor, formatMoney, minorUnits } from '@/lib/money';

export interface ExportRowExpense {
  date: string;
  title: string;
  payer: string;
  currency: string;
  amount: number;
  amountText: string;
  amountInGroup: number;
  amountInGroupText: string;
  /** Each cell value is the member's share in the source currency, as a number. */
  shares: Record<string, number>;
  /** Same per-member share but pre-formatted as a localized string. */
  sharesText: Record<string, string>;
  note: string;
  locked: boolean;
}

export interface ExportRowMember {
  member: string;
  paid: number;
  owed: number;
  net: number;
  paidText: string;
  owedText: string;
  netText: string;
}

export interface ExportRowTransfer {
  from: string;
  to: string;
  amount: number;
  amountText: string;
}

export interface ExportPayload {
  meta: {
    groupId: string;
    groupName: string;
    defaultCurrency: string;
    generatedAt: Date;
    locale: string;
  };
  members: { id: string; displayName: string }[];
  expenses: ExportRowExpense[];
  summary: ExportRowMember[];
  transfers: ExportRowTransfer[];
}

function minorToNumber(minor: bigint, currency: string): number {
  // Lossless within Number.MAX_SAFE_INTEGER (~9e15 minor units).
  const places = minorUnits(currency);
  return Number(minor) / Math.pow(10, places);
}

export async function buildExportPayload(
  groupId: string,
  locale: string = 'en-US',
): Promise<ExportPayload> {
  const ledger = await loadGroupLedger(groupId);
  const { group, members, expenses, summary, transfers } = ledger;

  const memberById = new Map(members.map((m) => [m.id, m]));

  return {
    meta: {
      groupId: group.id,
      groupName: group.name,
      defaultCurrency: group.defaultCurrency,
      generatedAt: new Date(),
      locale,
    },
    members: members.map((m) => ({ id: m.id, displayName: m.displayName })),
    expenses: expenses
      // DRAFTS have no amount yet — omit from exports.
      .filter((e) => !e.isDraft && e.amountMinor != null && e.fxRateToGroupCurrency != null)
      .map((e) => {
      const groupAmountMinor =
        e.currency === group.defaultCurrency
          ? e.amountMinor!
          : BigInt(
              Math.round(
                Number(e.amountMinor!) *
                  Number(e.fxRateToGroupCurrency!.toString()) *
                  Math.pow(10, minorUnits(group.defaultCurrency) - minorUnits(e.currency)),
              ),
            );
      const shares: Record<string, number> = {};
      const sharesText: Record<string, string> = {};
      for (const m of members) {
        const sm = e.splits.find((s) => s.memberId === m.id);
        const v = sm?.shareMinor ?? 0n;
        shares[m.displayName] = minorToNumber(v, e.currency);
        sharesText[m.displayName] = formatMinor(v, e.currency);
      }
      return {
        date: e.occurredAt.toISOString().slice(0, 10),
        title: e.title,
        payer: memberById.get(e.payerMemberId)?.displayName ?? '?',
        currency: e.currency,
        amount: minorToNumber(e.amountMinor!, e.currency),
        amountText: formatMoney(e.amountMinor!, e.currency, locale),
        amountInGroup: minorToNumber(groupAmountMinor, group.defaultCurrency),
        amountInGroupText: formatMoney(groupAmountMinor, group.defaultCurrency, locale),
        shares,
        sharesText,
        note: e.note ?? '',
        locked: e.lockedBySettlementId !== null,
      };
    }),
    summary: summary.map((s) => {
      const m = memberById.get(s.memberId)!;
      return {
        member: m.displayName,
        paid: minorToNumber(s.paidMinorInGroup, group.defaultCurrency),
        owed: minorToNumber(s.owedMinorInGroup, group.defaultCurrency),
        net: minorToNumber(s.netMinorInGroup, group.defaultCurrency),
        paidText: formatMoney(s.paidMinorInGroup, group.defaultCurrency, locale),
        owedText: formatMoney(s.owedMinorInGroup, group.defaultCurrency, locale),
        netText: formatMoney(s.netMinorInGroup, group.defaultCurrency, locale),
      };
    }),
    transfers: transfers.map((t) => ({
      from: memberById.get(t.from)?.displayName ?? '?',
      to: memberById.get(t.to)?.displayName ?? '?',
      amount: minorToNumber(t.amountMinor, group.defaultCurrency),
      amountText: formatMoney(t.amountMinor, group.defaultCurrency, locale),
    })),
  };
}
