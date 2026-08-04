import { computeLedgerSummary, settle } from '@aaeasy/core';
import type { Database } from '@aaeasy/db';
import {
  expenseSplits,
  expenses,
  groupMemberships,
  groups,
  members,
  settlementEntries,
  users,
} from '@aaeasy/db/schema';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type Executor = Database | Transaction;

export async function loadLedger(db: Executor, groupId: string) {
  const [group] = await db
    .select({
      id: groups.id,
      name: groups.name,
      defaultCurrency: groups.defaultCurrency,
      status: groups.status,
      revision: groups.revision,
    })
    .from(groups)
    .where(and(eq(groups.id, groupId), isNull(groups.deletedAt)))
    .limit(1);
  if (!group) return null;

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

  const expenseRows = await db
    .select()
    .from(expenses)
    .where(and(eq(expenses.groupId, groupId), isNull(expenses.deletedAt)))
    .orderBy(desc(expenses.occurredAt), desc(expenses.createdAt));
  const expenseIds = expenseRows.map((expense) => expense.id);
  const splitRows =
    expenseIds.length === 0
      ? []
      : await db
          .select({
            id: expenseSplits.id,
            expenseId: expenseSplits.expenseId,
            memberId: expenseSplits.memberId,
            shareMinor: expenseSplits.shareMinor,
          })
          .from(expenseSplits)
          .where(inArray(expenseSplits.expenseId, expenseIds));
  const splitsByExpense = new Map<string, typeof splitRows>();
  for (const split of splitRows) {
    const list = splitsByExpense.get(split.expenseId) ?? [];
    list.push(split);
    splitsByExpense.set(split.expenseId, list);
  }
  const entryRows = await db
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
    .orderBy(desc(settlementEntries.occurredAt));

  const ledgerExpenses = expenseRows.map((expense) => ({
    ...expense,
    splits: splitsByExpense.get(expense.id) ?? [],
  }));
  const rawSummary = computeLedgerSummary(group.defaultCurrency, memberRows, ledgerExpenses);
  const adjusted = new Map(rawSummary.map((row) => [row.memberId, row.netMinorInGroup]));
  for (const entry of entryRows) {
    adjusted.set(entry.fromMemberId, (adjusted.get(entry.fromMemberId) ?? 0n) + entry.amountMinor);
    adjusted.set(entry.toMemberId, (adjusted.get(entry.toMemberId) ?? 0n) - entry.amountMinor);
  }
  const summary = rawSummary.map((row) => ({
    ...row,
    adjustedNetMinorInGroup: adjusted.get(row.memberId) ?? row.netMinorInGroup,
  }));
  const transfers = settle(
    summary.map((row) => ({ memberId: row.memberId, netMinor: row.adjustedNetMinorInGroup })),
  );

  return {
    group,
    members: memberRows,
    expenses: ledgerExpenses,
    summary,
    transfers,
    settlementEntries: entryRows,
  };
}

export function serializeLedger(ledger: NonNullable<Awaited<ReturnType<typeof loadLedger>>>) {
  return {
    group: { ...ledger.group, revision: ledger.group.revision.toString() },
    members: ledger.members,
    expenses: ledger.expenses.map((expense) => ({
      ...expense,
      occurredAt: expense.occurredAt.toISOString(),
      amountMinor: expense.amountMinor?.toString() ?? null,
      splits: expense.splits.map((split) => ({
        id: split.id,
        memberId: split.memberId,
        shareMinor: split.shareMinor.toString(),
      })),
      createdAt: expense.createdAt.toISOString(),
      updatedAt: expense.updatedAt.toISOString(),
      deletedAt: null,
    })),
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
