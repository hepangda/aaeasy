/**
 * Query-side helpers for an expense ledger.
 *
 * `loadGroupLedger(groupId)` returns:
 *   - members ordered by `sortOrder`
 *   - active expenses with their persisted splits (in source currency)
 *   - per-member summary in the **group's default currency** (paid / owed /
 *     net), with each expense converted via its frozen `fxRateToGroupCurrency`
 *
 * Settlement instructions are produced by piping `summary` into `lib/settle`.
 */

import Decimal from 'decimal.js';
import { prisma } from '@/lib/db';
import { decimalToMinor, minorToDecimal } from '@/lib/money';
import { settle, type Transfer } from '@/lib/settle';

export interface MemberLite {
  id: string;
  displayName: string;
  sortOrder: number;
  linkedUserId: string | null;
  /** Username of the linked User, when one exists. Used by the members
   *  list to render `@username` next to the display name. */
  linkedUsername: string | null;
  /** Display name of the linked User, when one exists. The members UI
   *  prefers this over `displayName` so a renamed account shows up
   *  correctly without manually re-syncing every group. */
  linkedUserDisplayName: string | null;
  /** Role of the linked User in this group (when one exists). The members
   *  UI hides the share / unlink buttons for OWNER-linked members because
   *  unbinding the OWNER from their own member would break the group. */
  linkedUserRole: 'OWNER' | 'MANAGER' | 'MEMBER' | 'VIEWER' | null;
  color: string | null;
}

export interface ExpenseLite {
  id: string;
  occurredAt: Date;
  title: string;
  note: string | null;
  currency: string;
  /** Null while the expense is still a DRAFT (no amount entered yet). */
  amountMinor: bigint | null;
  /** Null while the expense is still a DRAFT. */
  fxRateToGroupCurrency: Decimal | null;
  payerMemberId: string;
  tags: string[];
  splits: { memberId: string; shareMinor: bigint }[];
  receipts: { id: string; mime: string; sizeBytes: number }[];
  splitRule: unknown;
  lockedBySettlementId: string | null;
  isDraft: boolean;
}

export interface MemberSummary {
  memberId: string;
  paidMinorInGroup: bigint;
  owedMinorInGroup: bigint;
  /** Net = paid − owed, BEFORE any SettlementEntry is applied. */
  netMinorInGroup: bigint;
  /** Net AFTER applying SettlementEntry rows. Equal to `netMinorInGroup`
   * when no entries exist. */
  adjustedNetMinorInGroup: bigint;
}

export interface SettlementEntryLite {
  id: string;
  fromMemberId: string;
  toMemberId: string;
  amountMinor: bigint;
  note: string | null;
  occurredAt: Date;
  createdByName: string | null;
}

export interface GroupLedger {
  group: {
    id: string;
    name: string;
    defaultCurrency: string;
    status: 'ACTIVE' | 'ARCHIVED';
  };
  members: MemberLite[];
  expenses: ExpenseLite[];
  summary: MemberSummary[];
  /** Suggested transfers based on the *adjusted* net (post-entries). */
  transfers: Transfer[];
  /** All recorded SettlementEntry rows, newest first. */
  settlementEntries: SettlementEntryLite[];
}

export async function loadGroupLedger(groupId: string): Promise<GroupLedger> {
  const group = await prisma.group.findUniqueOrThrow({
    where: { id: groupId },
    select: {
      id: true,
      name: true,
      defaultCurrency: true,
      status: true,
    },
  });

  const [members, expenses, settlementEntries] = await Promise.all([
    prisma.member.findMany({
      where: { groupId },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        displayName: true,
        sortOrder: true,
        linkedUserId: true,
        linkedUser: {
          select: {
            username: true,
            displayName: true,
            memberships: {
              where: { groupId },
              select: { role: true, groupId: true },
            },
          },
        },
        color: true,
      },
    }),
    prisma.expense.findMany({
      where: { groupId, deletedAt: null },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
      include: {
        splits: { select: { memberId: true, shareMinor: true } },
        receipts: {
          select: { id: true, mime: true, sizeBytes: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    }),
    prisma.settlementEntry.findMany({
      where: { groupId },
      orderBy: { occurredAt: 'desc' },
      include: { createdBy: { select: { displayName: true } } },
    }),
  ]);

  const expenseLites: ExpenseLite[] = expenses.map((e) => ({
    id: e.id,
    occurredAt: e.occurredAt,
    title: e.title,
    note: e.note,
    currency: e.currency,
    amountMinor: e.amountMinor,
    fxRateToGroupCurrency:
      e.fxRateToGroupCurrency != null
        ? new Decimal(e.fxRateToGroupCurrency.toString())
        : null,
    payerMemberId: e.payerMemberId,
    tags: e.tags,
    splits: e.splits,
    receipts: e.receipts,
    splitRule: e.splitRule,
    lockedBySettlementId: e.lockedBySettlementId,
    isDraft: e.isDraft,
  }));

  const memberLites: MemberLite[] = members.map((m) => ({
    id: m.id,
    displayName: m.displayName,
    sortOrder: m.sortOrder,
    linkedUserId: m.linkedUserId,
    linkedUsername: m.linkedUser?.username ?? null,
    linkedUserDisplayName: m.linkedUser?.displayName ?? null,
    linkedUserRole:
      m.linkedUser?.memberships.find((mm) => mm.groupId === groupId)?.role ?? null,
    color: m.color,
  }));

  const rawSummary = computeSummary(group.defaultCurrency, memberLites, expenseLites);

  // Apply each SettlementEntry: a payment of `amount` from A → B means A
  // owes `amount` less and B is owed `amount` less. Both nets move toward
  // zero by exactly `amount`.
  const adjustedNet = new Map<string, bigint>(
    rawSummary.map((s) => [s.memberId, s.netMinorInGroup]),
  );
  for (const e of settlementEntries) {
    adjustedNet.set(e.fromMemberId, (adjustedNet.get(e.fromMemberId) ?? 0n) + e.amountMinor);
    adjustedNet.set(e.toMemberId, (adjustedNet.get(e.toMemberId) ?? 0n) - e.amountMinor);
  }

  const summary: MemberSummary[] = rawSummary.map((s) => ({
    ...s,
    adjustedNetMinorInGroup: adjustedNet.get(s.memberId) ?? s.netMinorInGroup,
  }));

  const transfers = settle(
    Array.from(adjustedNet, ([memberId, netMinor]) => ({ memberId, netMinor })),
  );

  const entryLites: SettlementEntryLite[] = settlementEntries.map((e) => ({
    id: e.id,
    fromMemberId: e.fromMemberId,
    toMemberId: e.toMemberId,
    amountMinor: e.amountMinor,
    note: e.note,
    occurredAt: e.occurredAt,
    createdByName: e.createdBy?.displayName ?? null,
  }));

  return {
    group,
    members: memberLites,
    expenses: expenseLites,
    summary,
    transfers,
    settlementEntries: entryLites,
  };
}

/**
 * Pure function — exported for tests too. For each expense:
 *   amountInGroup = amountMinor (in srcCurrency) * fxRate, rounded to group's minor units
 *   shareInGroup  = shareMinor  (in srcCurrency) * fxRate, rounded to group's minor units
 * The conversion is per-expense so different historical rates compose correctly.
 */
/** "Raw" member summary without `adjustedNet` — that field is added by
 *  `loadGroupLedger` after applying SettlementEntry rows. */
export type RawMemberSummary = Omit<MemberSummary, 'adjustedNetMinorInGroup'>;

export function computeSummary(
  groupCurrency: string,
  members: readonly MemberLite[],
  expenses: readonly ExpenseLite[],
): RawMemberSummary[] {
  const paid = new Map<string, bigint>(members.map((m) => [m.id, 0n]));
  const owed = new Map<string, bigint>(members.map((m) => [m.id, 0n]));

  for (const e of expenses) {
    // DRAFT expenses have no amount or splits and must be ignored by the
    // ledger — they only show up as "please fill" placeholders in the UI.
    if (e.amountMinor == null || e.fxRateToGroupCurrency == null) continue;
    const amountInGroupMinor = convertToGroup(e.amountMinor, e.currency, groupCurrency, e.fxRateToGroupCurrency);
    paid.set(e.payerMemberId, (paid.get(e.payerMemberId) ?? 0n) + amountInGroupMinor);

    // Convert each share. To avoid sub-unit drift between Σshares and amount,
    // we recompute in group currency by scaling each share's *proportion* of
    // the source amount, then adjust the last entry to absorb any 1-unit
    // remainder.
    if (amountInGroupMinor === 0n || e.amountMinor === 0n) continue;
    let assigned = 0n;
    const ordered = [...e.splits].sort((a, b) => (a.memberId < b.memberId ? -1 : 1));
    for (let i = 0; i < ordered.length; i++) {
      const s = ordered[i]!;
      const isLast = i === ordered.length - 1;
      let convMinor: bigint;
      if (isLast) {
        convMinor = amountInGroupMinor - assigned;
      } else {
        convMinor = convertToGroup(s.shareMinor, e.currency, groupCurrency, e.fxRateToGroupCurrency);
        assigned += convMinor;
      }
      owed.set(s.memberId, (owed.get(s.memberId) ?? 0n) + convMinor);
    }
  }

  return members.map((m) => {
    const p = paid.get(m.id) ?? 0n;
    const o = owed.get(m.id) ?? 0n;
    return {
      memberId: m.id,
      paidMinorInGroup: p,
      owedMinorInGroup: o,
      netMinorInGroup: p - o,
    };
  });
}

function convertToGroup(
  minor: bigint,
  fromCurrency: string,
  toCurrency: string,
  rate: Decimal,
): bigint {
  if (fromCurrency === toCurrency) return minor;
  const major = minorToDecimal(minor, fromCurrency).times(rate);
  return decimalToMinor(major, toCurrency);
}
