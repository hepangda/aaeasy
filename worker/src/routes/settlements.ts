import { settlementEntrySchema } from '@aaeasy/contracts';
import { computeLedgerSummary, parseAmountToMinor, settle } from '@aaeasy/core';
import {
  auditLogs,
  expenseSplits,
  expenses,
  groups,
  members,
  settlements,
  settlementEntries,
} from '@aaeasy/db/schema';
import { createId } from '@paralleldrive/cuid2';
import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppEnv } from '../app-env';
import { boundMember, requireGroupAccess, type GroupAccess } from '../auth/access';
import { getCurrentSession } from '../auth/session';
import { bumpGroupRevision, scheduleGroupEvent } from '../realtime/events';

export const settlementRoutes = new Hono<AppEnv>();

function eventActor(access: GroupAccess): string {
  return access.kind === 'user' ? access.userId : access.shareLinkId;
}

settlementRoutes.post('/groups/:groupId/settlements', async (c) => {
  const groupId = c.req.param('groupId');
  // SETTLE is never granted to share access, so this is always a user.
  const access = await requireGroupAccess(c, groupId, 'SETTLE');
  const userId = eventActor(access);
  const [group] = await c.var.db
    .select({
      id: groups.id,
      name: groups.name,
      defaultCurrency: groups.defaultCurrency,
      status: groups.status,
    })
    .from(groups)
    .where(eq(groups.id, groupId))
    .limit(1);
  if (!group) return c.json({ ok: false, error: 'errors.not_found' }, 404);

  const memberRows = await c.var.db
    .select({ id: members.id, displayName: members.displayName })
    .from(members)
    .where(eq(members.groupId, groupId))
    .orderBy(asc(members.sortOrder), asc(members.createdAt));
  const expenseRows = await c.var.db
    .select()
    .from(expenses)
    .where(
      and(
        eq(expenses.groupId, groupId),
        isNull(expenses.deletedAt),
        isNull(expenses.lockedBySettlementId),
      ),
    )
    .orderBy(asc(expenses.occurredAt));
  if (expenseRows.length === 0) {
    return c.json({ ok: false, error: 'errors.nothing_to_settle' }, 409);
  }
  const expenseIds = expenseRows.map((expense) => expense.id);
  const splitRows = await c.var.db
    .select({
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
  const expensesWithSplits = expenseRows.map((expense) => ({
    ...expense,
    splits: splitsByExpense.get(expense.id) ?? [],
  }));
  const summary = computeLedgerSummary(group.defaultCurrency, memberRows, expensesWithSplits);
  const transfers = settle(
    summary.map((row) => ({ memberId: row.memberId, netMinor: row.netMinorInGroup })),
  );
  const now = new Date();
  const snapshot = {
    version: 2,
    groupId,
    groupName: group.name,
    defaultCurrency: group.defaultCurrency,
    createdAt: now.toISOString(),
    members: memberRows,
    expenses: expensesWithSplits.map((expense) => ({
      id: expense.id,
      occurredAt: expense.occurredAt.toISOString(),
      title: expense.title,
      currency: expense.currency,
      amountMinor: expense.amountMinor!.toString(),
      fxRateToGroupCurrency: expense.fxRateToGroupCurrency!,
      payerMemberId: expense.payerMemberId,
      splits: expense.splits.map((split) => ({
        memberId: split.memberId,
        shareMinor: split.shareMinor.toString(),
      })),
    })),
    summary: summary.map((row) => ({
      memberId: row.memberId,
      paidMinorInGroup: row.paidMinorInGroup.toString(),
      owedMinorInGroup: row.owedMinorInGroup.toString(),
      netMinorInGroup: row.netMinorInGroup.toString(),
    })),
    transfers: transfers.map((transfer) => ({
      from: transfer.from,
      to: transfer.to,
      amountMinor: transfer.amountMinor.toString(),
    })),
  };
  const settlementId = createId();
  const revision = await c.var.db.transaction(async (tx) => {
    await tx.insert(settlements).values({
      id: settlementId,
      groupId,
      snapshotJson: snapshot,
      createdById: userId,
    });
    await tx
      .update(expenses)
      .set({
        lockedBySettlementId: settlementId,
        updatedAt: now,
        version: sql`${expenses.version} + 1`,
      })
      .where(inArray(expenses.id, expenseIds));
    await tx.update(groups).set({ status: 'ARCHIVED' }).where(eq(groups.id, groupId));
    await tx.insert(auditLogs).values({
      id: createId(),
      groupId,
      actorType: 'USER',
      actorId: userId,
      action: 'SETTLEMENT_CREATE',
      targetType: 'Settlement',
      targetId: settlementId,
    });
    return bumpGroupRevision(tx, groupId);
  });
  scheduleGroupEvent(c, groupId, {
    revision,
    type: 'settlement.changed',
    entityId: settlementId,
    actorId: eventActor(access),
  });
  return c.json({ ok: true, settlementId, revision }, 201);
});

settlementRoutes.post('/groups/:groupId/settlements/:settlementId/reopen', async (c) => {
  const groupId = c.req.param('groupId');
  const settlementId = c.req.param('settlementId');
  // SETTLE is never granted to share access, so this is always a user.
  const access = await requireGroupAccess(c, groupId, 'SETTLE');
  const userId = eventActor(access);
  const [settlement] = await c.var.db
    .select({ id: settlements.id })
    .from(settlements)
    .where(and(eq(settlements.id, settlementId), eq(settlements.groupId, groupId)))
    .limit(1);
  if (!settlement) return c.json({ ok: false, error: 'errors.not_found' }, 404);
  const revision = await c.var.db.transaction(async (tx) => {
    await tx
      .update(expenses)
      .set({
        lockedBySettlementId: null,
        updatedAt: new Date(),
        version: sql`${expenses.version} + 1`,
      })
      .where(eq(expenses.lockedBySettlementId, settlementId));
    await tx.delete(settlements).where(eq(settlements.id, settlementId));
    await tx.update(groups).set({ status: 'ACTIVE' }).where(eq(groups.id, groupId));
    await tx.insert(auditLogs).values({
      id: createId(),
      groupId,
      actorType: 'USER',
      actorId: userId,
      action: 'SETTLEMENT_REOPEN',
      targetType: 'Settlement',
      targetId: settlementId,
    });
    return bumpGroupRevision(tx, groupId);
  });
  scheduleGroupEvent(c, groupId, {
    revision,
    type: 'settlement.changed',
    entityId: settlementId,
    actorId: eventActor(access),
  });
  return c.json({ ok: true, revision });
});

settlementRoutes.post('/groups/:groupId/settlement-entries', async (c) => {
  const groupId = c.req.param('groupId');
  const parsed = settlementEntrySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ ok: false, error: 'errors.invalid_input' }, 400);
  if (parsed.data.fromMemberId === parsed.data.toMemberId) {
    return c.json({ ok: false, error: 'errors.same_member' }, 400);
  }
  const access = await requireGroupAccess(c, groupId, 'WRITE_EXPENSE');
  const constrained = boundMember(access);
  if (
    constrained &&
    parsed.data.fromMemberId !== constrained &&
    parsed.data.toMemberId !== constrained
  ) {
    return c.json({ ok: false, error: 'errors.forbidden' }, 403);
  }
  const [group] = await c.var.db
    .select({ defaultCurrency: groups.defaultCurrency })
    .from(groups)
    .where(eq(groups.id, groupId))
    .limit(1);
  const validMembers = await c.var.db
    .select({ id: members.id })
    .from(members)
    .where(
      and(
        eq(members.groupId, groupId),
        or(eq(members.id, parsed.data.fromMemberId), eq(members.id, parsed.data.toMemberId)),
      ),
    );
  if (!group || validMembers.length !== 2) {
    return c.json({ ok: false, error: 'errors.unknown_payer' }, 400);
  }
  let amountMinor: bigint;
  try {
    amountMinor = parseAmountToMinor(parsed.data.amount, group.defaultCurrency);
  } catch {
    return c.json({ ok: false, error: 'errors.invalid_amount' }, 400);
  }
  if (amountMinor <= 0n) return c.json({ ok: false, error: 'errors.amount_negative' }, 400);
  const session = await getCurrentSession(c);
  const entryId = createId();
  const revision = await c.var.db.transaction(async (tx) => {
    await tx.insert(settlementEntries).values({
      id: entryId,
      groupId,
      fromMemberId: parsed.data.fromMemberId,
      toMemberId: parsed.data.toMemberId,
      amountMinor,
      note: parsed.data.note || null,
      occurredAt: parsed.data.occurredAt ? new Date(parsed.data.occurredAt) : new Date(),
      createdById: session?.user.id ?? null,
    });
    return bumpGroupRevision(tx, groupId);
  });
  scheduleGroupEvent(c, groupId, {
    revision,
    type: 'settlement.changed',
    entityId: entryId,
    actorId: eventActor(access),
  });
  return c.json({ ok: true, entryId, revision }, 201);
});

settlementRoutes.delete('/groups/:groupId/settlement-entries/:entryId', async (c) => {
  const groupId = c.req.param('groupId');
  const entryId = c.req.param('entryId');
  const [entry] = await c.var.db
    .select({
      fromMemberId: settlementEntries.fromMemberId,
      toMemberId: settlementEntries.toMemberId,
    })
    .from(settlementEntries)
    .where(and(eq(settlementEntries.id, entryId), eq(settlementEntries.groupId, groupId)))
    .limit(1);
  if (!entry) return c.json({ ok: false, error: 'errors.not_found' }, 404);
  const access = await requireGroupAccess(c, groupId, 'WRITE_EXPENSE');
  const constrained = boundMember(access);
  if (constrained && entry.fromMemberId !== constrained && entry.toMemberId !== constrained) {
    return c.json({ ok: false, error: 'errors.forbidden' }, 403);
  }
  const revision = await c.var.db.transaction(async (tx) => {
    await tx.delete(settlementEntries).where(eq(settlementEntries.id, entryId));
    return bumpGroupRevision(tx, groupId);
  });
  scheduleGroupEvent(c, groupId, {
    revision,
    type: 'settlement.changed',
    entityId: entryId,
    actorId: eventActor(access),
  });
  return c.json({ ok: true, revision });
});
