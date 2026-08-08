import { settlementEntrySchema } from '@aaeasy/contracts';
import { computeLedgerSummary, parseAmountToMinor, settle } from '@aaeasy/core';
import {
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
import { actorId, boundMember, requireGroupAccess } from '../auth/access';
import { getCurrentSession } from '../auth/session';
import { auditActor, writeAudit } from '../lib/audit';
import { isTransactionConflict } from '../lib/pg-errors';
import { bumpGroupRevision, scheduleGroupEvent } from '../realtime/events';

export const settlementRoutes = new Hono<AppEnv>();

settlementRoutes.post('/groups/:groupId/settlements', async (c) => {
  const groupId = c.req.param('groupId');
  // SETTLE is never granted to share access, so this is always a user.
  const { access } = await requireGroupAccess(c, groupId, 'SETTLE');
  const userId = actorId(access);
  const settlementId = createId();

  let result: { ok: true; revision: string } | { ok: false; error: string; status: 404 | 409 };
  try {
    result = await c.var.db.transaction(
      async (tx) => {
        // Lock the group before reading the snapshot. Expense writes take the
        // same lock, so closing a ledger and adding/editing an expense cannot
        // cross in flight and leave an unlocked expense in an archived group.
        const [group] = await tx
          .select({
            id: groups.id,
            name: groups.name,
            defaultCurrency: groups.defaultCurrency,
            status: groups.status,
          })
          .from(groups)
          .where(eq(groups.id, groupId))
          .limit(1)
          .for('update');
        if (!group) return { ok: false, error: 'errors.not_found', status: 404 } as const;
        if (group.status !== 'ACTIVE') {
          return { ok: false, error: 'errors.nothing_to_settle', status: 409 } as const;
        }

        const memberRows = await tx
          .select({ id: members.id, displayName: members.displayName })
          .from(members)
          .where(eq(members.groupId, groupId))
          .orderBy(asc(members.sortOrder), asc(members.createdAt));
        const expenseRows = await tx
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
          return { ok: false, error: 'errors.nothing_to_settle', status: 409 } as const;
        }

        const expenseIds = expenseRows.map((expense) => expense.id);
        const splitRows = await tx
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
            amountMinor: expense.amountMinor.toString(),
            fxRateToGroupCurrency: expense.fxRateToGroupCurrency,
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

        await tx.insert(settlements).values({
          id: settlementId,
          groupId,
          snapshotJson: snapshot,
          createdById: userId,
        });
        const locked = await tx
          .update(expenses)
          .set({
            lockedBySettlementId: settlementId,
            updatedAt: now,
            version: sql`${expenses.version} + 1`,
          })
          .where(
            and(
              inArray(expenses.id, expenseIds),
              eq(expenses.groupId, groupId),
              isNull(expenses.deletedAt),
              isNull(expenses.lockedBySettlementId),
            ),
          )
          .returning({ id: expenses.id });
        if (locked.length !== expenseIds.length) {
          throw new Error('SETTLEMENT_EXPENSE_SET_CHANGED');
        }
        await tx.update(groups).set({ status: 'ARCHIVED' }).where(eq(groups.id, groupId));
        await writeAudit(tx, {
          groupId,
          actor: auditActor(access),
          action: 'SETTLEMENT_CREATE',
          targetType: 'Settlement',
          targetId: settlementId,
          diff: { expenseCount: expenseIds.length, transferCount: transfers.length },
        });
        return { ok: true, revision: await bumpGroupRevision(tx, groupId) } as const;
      },
      { isolationLevel: 'serializable', accessMode: 'read write' },
    );
  } catch (error) {
    if (!isTransactionConflict(error)) throw error;
    result = { ok: false, error: 'errors.conflict', status: 409 };
  }

  if (!result.ok) return c.json({ ok: false, error: result.error }, result.status);
  scheduleGroupEvent(c, groupId, {
    revision: result.revision,
    type: 'settlement.changed',
    entityId: settlementId,
    actorId: actorId(access),
  });
  return c.json({ ok: true, settlementId, revision: result.revision }, 201);
});

settlementRoutes.post('/groups/:groupId/settlements/:settlementId/reopen', async (c) => {
  const groupId = c.req.param('groupId');
  const settlementId = c.req.param('settlementId');
  // SETTLE is never granted to share access, so this is always a user.
  const { access } = await requireGroupAccess(c, groupId, 'SETTLE');
  const userId = actorId(access);

  let result: { ok: true; revision: string } | { ok: false; error: string; status: 404 | 409 };
  try {
    result = await c.var.db.transaction(
      async (tx) => {
        const [group] = await tx
          .select({ status: groups.status })
          .from(groups)
          .where(eq(groups.id, groupId))
          .limit(1)
          .for('update');
        if (!group) return { ok: false, error: 'errors.not_found', status: 404 } as const;
        if (group.status !== 'ARCHIVED') {
          return { ok: false, error: 'errors.conflict', status: 409 } as const;
        }
        const [settlement] = await tx
          .select({ id: settlements.id })
          .from(settlements)
          .where(
            and(
              eq(settlements.id, settlementId),
              eq(settlements.groupId, groupId),
              isNull(settlements.reopenedAt),
            ),
          )
          .limit(1);
        if (!settlement) return { ok: false, error: 'errors.not_found', status: 404 } as const;

        const unlocked = await tx
          .update(expenses)
          .set({
            lockedBySettlementId: null,
            updatedAt: new Date(),
            version: sql`${expenses.version} + 1`,
          })
          .where(
            and(eq(expenses.groupId, groupId), eq(expenses.lockedBySettlementId, settlementId)),
          )
          .returning({ id: expenses.id });
        if (unlocked.length === 0) {
          return { ok: false, error: 'errors.conflict', status: 409 } as const;
        }
        // Retire the settlement instead of deleting it. The snapshot is the
        // only record of what the ledger looked like when it closed, and the
        // audit entry written just below points at this id.
        const retired = await tx
          .update(settlements)
          .set({ reopenedAt: new Date(), reopenedById: userId })
          .where(
            and(
              eq(settlements.id, settlementId),
              eq(settlements.groupId, groupId),
              isNull(settlements.reopenedAt),
            ),
          )
          .returning({ id: settlements.id });
        if (retired.length !== 1) {
          return { ok: false, error: 'errors.conflict', status: 409 } as const;
        }
        await tx.update(groups).set({ status: 'ACTIVE' }).where(eq(groups.id, groupId));
        await writeAudit(tx, {
          groupId,
          actor: auditActor(access),
          action: 'SETTLEMENT_REOPEN',
          targetType: 'Settlement',
          targetId: settlementId,
          diff: { unlockedExpenses: unlocked.length },
        });
        return { ok: true, revision: await bumpGroupRevision(tx, groupId) } as const;
      },
      { isolationLevel: 'serializable', accessMode: 'read write' },
    );
  } catch (error) {
    if (!isTransactionConflict(error)) throw error;
    result = { ok: false, error: 'errors.conflict', status: 409 };
  }

  if (!result.ok) return c.json({ ok: false, error: result.error }, result.status);
  scheduleGroupEvent(c, groupId, {
    revision: result.revision,
    type: 'settlement.changed',
    entityId: settlementId,
    actorId: actorId(access),
  });
  return c.json({ ok: true, revision: result.revision });
});

settlementRoutes.post('/groups/:groupId/settlement-entries', async (c) => {
  const groupId = c.req.param('groupId');
  const parsed = settlementEntrySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ ok: false, error: 'errors.invalid_input' }, 400);
  if (parsed.data.fromMemberId === parsed.data.toMemberId) {
    return c.json({ ok: false, error: 'errors.same_member' }, 400);
  }
  const { access } = await requireGroupAccess(c, groupId, 'WRITE_EXPENSE');
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
    await writeAudit(tx, {
      groupId,
      actor: auditActor(access),
      action: 'SETTLEMENT_ENTRY_CREATE',
      targetType: 'SettlementEntry',
      targetId: entryId,
      diff: {
        fromMemberId: parsed.data.fromMemberId,
        toMemberId: parsed.data.toMemberId,
        amountMinor: amountMinor.toString(),
      },
    });
    return bumpGroupRevision(tx, groupId);
  });
  scheduleGroupEvent(c, groupId, {
    revision,
    type: 'settlement.changed',
    entityId: entryId,
    actorId: actorId(access),
  });
  return c.json({ ok: true, entryId, revision }, 201);
});

settlementRoutes.delete('/groups/:groupId/settlement-entries/:entryId', async (c) => {
  const groupId = c.req.param('groupId');
  const entryId = c.req.param('entryId');
  const { access } = await requireGroupAccess(c, groupId, 'WRITE_EXPENSE');
  const [entry] = await c.var.db
    .select({
      fromMemberId: settlementEntries.fromMemberId,
      toMemberId: settlementEntries.toMemberId,
      amountMinor: settlementEntries.amountMinor,
    })
    .from(settlementEntries)
    .where(and(eq(settlementEntries.id, entryId), eq(settlementEntries.groupId, groupId)))
    .limit(1);
  if (!entry) return c.json({ ok: false, error: 'errors.not_found' }, 404);
  const constrained = boundMember(access);
  if (constrained && entry.fromMemberId !== constrained && entry.toMemberId !== constrained) {
    return c.json({ ok: false, error: 'errors.forbidden' }, 403);
  }
  const revision = await c.var.db.transaction(async (tx) => {
    await tx.delete(settlementEntries).where(eq(settlementEntries.id, entryId));
    await writeAudit(tx, {
      groupId,
      actor: auditActor(access),
      action: 'SETTLEMENT_ENTRY_DELETE',
      targetType: 'SettlementEntry',
      targetId: entryId,
      diff: {
        fromMemberId: entry.fromMemberId,
        toMemberId: entry.toMemberId,
        amountMinor: entry.amountMinor.toString(),
      },
    });
    return bumpGroupRevision(tx, groupId);
  });
  scheduleGroupEvent(c, groupId, {
    revision,
    type: 'settlement.changed',
    entityId: entryId,
    actorId: actorId(access),
  });
  return c.json({ ok: true, revision });
});
