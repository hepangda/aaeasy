import { computeLedgerSummary, settle, type LedgerSummary } from '@aaeasy/core';
import type { Database } from '@aaeasy/db';
import {
  expenseSplits,
  expenses,
  groupMemberships,
  members,
  settlementEntries,
  users,
} from '@aaeasy/db/schema';
import type { GroupRow } from '@aaeasy/db/schema';
import { and, asc, count, desc, eq, inArray, isNull, ne, sql, sum } from 'drizzle-orm';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type Executor = Database | Transaction;

type ExpenseRow = typeof expenses.$inferSelect;

interface LoadLedgerOptions {
  expensePage?: { page: number; pageSize: number };
}

export interface ForeignExpense {
  amountMinor: bigint;
  currency: string;
  fxRateToGroupCurrency: string;
  payerMemberId: string;
  splits: Array<{ memberId: string; shareMinor: bigint }>;
}

/**
 * Ledger totals, from two SQL sums plus whatever needs FX conversion.
 *
 * The summary is a whole-ledger aggregate, so *something* has to look at every
 * expense. What it should not do — and used to — is ship every expense and
 * every split row to the Worker on each page view.
 *
 * `convertMinor` is the identity when an expense is already in the group's
 * currency, and `computeSplit` guarantees the shares of one expense sum to its
 * total, so for those expenses the per-expense residual assignment in
 * `computeLedgerSummary` is a no-op and plain `sum()` in SQL gives the same
 * answer to the minor unit. Only foreign-currency expenses — normally a
 * handful — need the row-by-row treatment, and only those are fetched.
 */
export function mergeSummary(input: {
  memberIds: readonly string[];
  paidByMember: ReadonlyMap<string, bigint>;
  owedByMember: ReadonlyMap<string, bigint>;
  foreignSummary: readonly LedgerSummary[];
}): LedgerSummary[] {
  const foreignByMember = new Map(input.foreignSummary.map((row) => [row.memberId, row]));
  return input.memberIds.map((memberId) => {
    const foreign = foreignByMember.get(memberId);
    const paid = (input.paidByMember.get(memberId) ?? 0n) + (foreign?.paidMinorInGroup ?? 0n);
    const owed = (input.owedByMember.get(memberId) ?? 0n) + (foreign?.owedMinorInGroup ?? 0n);
    return {
      memberId,
      paidMinorInGroup: paid,
      owedMinorInGroup: owed,
      netMinorInGroup: paid - owed,
    };
  });
}

/** Apply recorded transfers on top of the computed net positions. */
export function applySettlementEntries(
  summary: readonly LedgerSummary[],
  entries: ReadonlyArray<{ fromMemberId: string; toMemberId: string; amountMinor: bigint }>,
) {
  const adjusted = new Map(summary.map((row) => [row.memberId, row.netMinorInGroup]));
  for (const entry of entries) {
    adjusted.set(entry.fromMemberId, (adjusted.get(entry.fromMemberId) ?? 0n) + entry.amountMinor);
    adjusted.set(entry.toMemberId, (adjusted.get(entry.toMemberId) ?? 0n) - entry.amountMinor);
  }
  return summary.map((row) => ({
    ...row,
    adjustedNetMinorInGroup: adjusted.get(row.memberId) ?? row.netMinorInGroup,
  }));
}

function toBigInt(value: string | number | null): bigint {
  return value === null ? 0n : BigInt(value);
}

export async function loadLedger(
  db: Executor,
  group: Pick<GroupRow, 'id' | 'name' | 'defaultCurrency' | 'status' | 'revision'>,
  options: LoadLedgerOptions = {},
) {
  const groupId = group.id;
  const live = and(eq(expenses.groupId, groupId), isNull(expenses.deletedAt));
  const foreign = and(live, ne(expenses.currency, group.defaultCurrency));

  const memberRows = await db
    .select({
      id: members.id,
      displayName: members.displayName,
      sortOrder: members.sortOrder,
      linkedUserId: members.linkedUserId,
      linkedUsername: users.username,
      linkedUserDisplayName: users.displayName,
      linkedUserPicture: users.picture,
      linkedUserRole: groupMemberships.role,
      color: members.color,
    })
    .from(members)
    .leftJoin(users, eq(users.id, members.linkedUserId))
    .leftJoin(
      groupMemberships,
      and(eq(groupMemberships.userId, members.linkedUserId), eq(groupMemberships.groupId, groupId)),
    )
    .where(eq(members.groupId, groupId))
    .orderBy(asc(members.sortOrder), asc(members.createdAt));

  const [totals, paidRows, owedRows, foreignExpenseRows, entryRows] = await Promise.all([
    db
      .select({
        totalItems: count(),
        openCount: sql<string>`count(*) filter (where ${expenses.lockedBySettlementId} is null)`,
      })
      .from(expenses)
      .where(live),
    db
      .select({ memberId: expenses.payerMemberId, paid: sum(expenses.amountMinor) })
      .from(expenses)
      .where(and(live, eq(expenses.currency, group.defaultCurrency)))
      .groupBy(expenses.payerMemberId),
    db
      .select({ memberId: expenseSplits.memberId, owed: sum(expenseSplits.shareMinor) })
      .from(expenseSplits)
      .innerJoin(expenses, eq(expenses.id, expenseSplits.expenseId))
      .where(and(live, eq(expenses.currency, group.defaultCurrency)))
      .groupBy(expenseSplits.memberId),
    db
      .select({
        id: expenses.id,
        amountMinor: expenses.amountMinor,
        currency: expenses.currency,
        fxRateToGroupCurrency: expenses.fxRateToGroupCurrency,
        payerMemberId: expenses.payerMemberId,
      })
      .from(expenses)
      .where(foreign),
    db
      .select({
        id: settlementEntries.id,
        fromMemberId: settlementEntries.fromMemberId,
        toMemberId: settlementEntries.toMemberId,
        amountMinor: settlementEntries.amountMinor,
        note: settlementEntries.note,
        occurredAt: settlementEntries.occurredAt,
        createdByName: users.displayName,
      })
      .from(settlementEntries)
      .leftJoin(users, eq(users.id, settlementEntries.createdById))
      .where(eq(settlementEntries.groupId, groupId))
      .orderBy(desc(settlementEntries.occurredAt)),
  ]);

  const totalItems = totals[0]?.totalItems ?? 0;
  const pageSize = options.expensePage
    ? Math.min(100, Math.max(1, Math.trunc(options.expensePage.pageSize) || 1))
    : Math.max(1, totalItems);
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const requestedPage =
    options.expensePage && Number.isFinite(options.expensePage.page)
      ? Math.max(1, Math.trunc(options.expensePage.page))
      : 1;
  const page = Math.min(requestedPage, totalPages);

  const expenseRows: ExpenseRow[] = await db
    .select()
    .from(expenses)
    .where(live)
    .orderBy(desc(expenses.occurredAt), desc(expenses.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  // Splits are fetched for the page being rendered and for the foreign-currency
  // expenses the summary has to walk -- not for the whole ledger.
  const splitExpenseIds = [
    ...new Set([...expenseRows.map((row) => row.id), ...foreignExpenseRows.map((row) => row.id)]),
  ];
  const splitRows =
    splitExpenseIds.length === 0
      ? []
      : await db
          .select({
            id: expenseSplits.id,
            expenseId: expenseSplits.expenseId,
            memberId: expenseSplits.memberId,
            shareMinor: expenseSplits.shareMinor,
          })
          .from(expenseSplits)
          .where(inArray(expenseSplits.expenseId, splitExpenseIds));
  const splitsByExpense = new Map<string, typeof splitRows>();
  for (const split of splitRows) {
    const list = splitsByExpense.get(split.expenseId) ?? [];
    list.push(split);
    splitsByExpense.set(split.expenseId, list);
  }

  const summary = applySettlementEntries(
    mergeSummary({
      memberIds: memberRows.map((member) => member.id),
      paidByMember: new Map(paidRows.map((row) => [row.memberId, toBigInt(row.paid)])),
      owedByMember: new Map(owedRows.map((row) => [row.memberId, toBigInt(row.owed)])),
      foreignSummary: computeLedgerSummary(
        group.defaultCurrency,
        memberRows,
        foreignExpenseRows.map((expense) => ({
          ...expense,
          splits: splitsByExpense.get(expense.id) ?? [],
        })),
      ),
    }),
    entryRows,
  );
  const transfers = settle(
    summary.map((row) => ({ memberId: row.memberId, netMinor: row.adjustedNetMinorInGroup })),
  );

  return {
    group,
    members: memberRows,
    expenses: expenseRows.map((expense) => ({
      ...expense,
      splits: splitsByExpense.get(expense.id) ?? [],
    })),
    expensePage: { page, pageSize, totalItems, totalPages },
    openExpenseCount: Number(totals[0]?.openCount ?? 0),
    summary,
    transfers,
    settlementEntries: entryRows,
  };
}

export function serializeLedger(ledger: Awaited<ReturnType<typeof loadLedger>>) {
  return {
    group: {
      id: ledger.group.id,
      name: ledger.group.name,
      defaultCurrency: ledger.group.defaultCurrency,
      status: ledger.group.status,
      revision: ledger.group.revision.toString(),
    },
    members: ledger.members,
    expenses: ledger.expenses.map((expense) => ({
      ...expense,
      occurredAt: expense.occurredAt.toISOString(),
      amountMinor: expense.amountMinor.toString(),
      splits: expense.splits.map((split) => ({
        id: split.id,
        memberId: split.memberId,
        shareMinor: split.shareMinor.toString(),
      })),
      createdAt: expense.createdAt.toISOString(),
      updatedAt: expense.updatedAt.toISOString(),
      deletedAt: null,
    })),
    expensePage: ledger.expensePage,
    openExpenseCount: ledger.openExpenseCount,
    summary: ledger.summary.map((row) => ({
      memberId: row.memberId,
      paidMinorInGroup: row.paidMinorInGroup.toString(),
      owedMinorInGroup: row.owedMinorInGroup.toString(),
      netMinorInGroup: row.netMinorInGroup.toString(),
      adjustedNetMinorInGroup: row.adjustedNetMinorInGroup.toString(),
    })),
    transfers: ledger.transfers.map((transfer) => ({
      from: transfer.from,
      to: transfer.to,
      amountMinor: transfer.amountMinor.toString(),
    })),
    settlementEntries: ledger.settlementEntries.map((entry) => ({
      ...entry,
      amountMinor: entry.amountMinor.toString(),
      occurredAt: entry.occurredAt.toISOString(),
    })),
  };
}
