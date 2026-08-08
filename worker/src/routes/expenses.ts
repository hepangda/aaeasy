import { expenseInputSchema, updateExpenseInputSchema, type ExpenseInput } from '@aaeasy/contracts';
import { computeSplit, parseAmountToMinor, parsePageNumber, SplitError } from '@aaeasy/core';
import type { Database } from '@aaeasy/db';
import { expenseSplits, expenses, groups, members } from '@aaeasy/db/schema';
import type { GroupRow } from '@aaeasy/db/schema';
import { createId } from '@paralleldrive/cuid2';
import Decimal from 'decimal.js';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import type { AppEnv } from '../app-env';
import { boundMember, requireGroupAccess, type GroupAccess } from '../auth/access';
import { auditActor, writeAudit } from '../lib/audit';
import { bumpGroupRevision, scheduleGroupEvent } from '../realtime/events';
import { getFxRate } from '../services/fx';
import { loadLedger, serializeLedger } from '../services/ledger';

export const expenseRoutes = new Hono<AppEnv>();

const LEDGER_EXPENSE_PAGE_SIZE = 10;

type MaterializedExpense = {
  amountMinor: bigint;
  fxRate: Decimal;
  splits: Map<string, bigint>;
};

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

async function lockWritableGroup(
  tx: Transaction,
  groupId: string,
): Promise<'active' | 'archived' | 'missing'> {
  const [group] = await tx
    .select({ status: groups.status })
    .from(groups)
    .where(eq(groups.id, groupId))
    .limit(1)
    .for('update');
  if (!group) return 'missing';
  return group.status === 'ACTIVE' ? 'active' : 'archived';
}

function actor(access: GroupAccess) {
  return access.kind === 'user'
    ? {
        createdByUserId: access.userId,
        createdByShareLinkId: null,
        auditType: 'USER' as const,
        auditId: access.userId,
      }
    : {
        createdByUserId: null,
        createdByShareLinkId: access.shareLinkId,
        auditType: 'SHARE' as const,
        auditId: access.shareLinkId,
      };
}

function inputError(error: unknown): string {
  if (error instanceof SplitError) return `errors.split_${error.code.toLowerCase()}`;
  if (error instanceof Error) {
    if (error.message.startsWith('errors.')) return error.message;
    if (error.message === 'AMOUNT_NEGATIVE') return 'errors.amount_negative';
    if (error.message.startsWith('AMOUNT_')) return 'errors.invalid_amount';
  }
  return 'errors.unknown';
}

async function materialize(
  c: Context<AppEnv>,
  group: Pick<GroupRow, 'id' | 'defaultCurrency' | 'status'>,
  input: ExpenseInput,
): Promise<MaterializedExpense> {
  const amountMinor = parseAmountToMinor(input.amount, input.currency);
  if (group.status === 'ARCHIVED') throw new Error('errors.expense_locked');

  let fxRate: Decimal;
  if (input.currency === group.defaultCurrency) {
    fxRate = new Decimal(1);
  } else if (input.fxRateOverride) {
    fxRate = new Decimal(input.fxRateOverride);
    if (!fxRate.isFinite() || fxRate.lte(0)) throw new Error('errors.invalid_fx_rate');
  } else {
    const fetched = await getFxRate(c.var.db, {
      base: input.currency,
      quote: group.defaultCurrency,
      date: new Date(input.occurredAt),
    });
    if (!fetched) throw new Error('errors.fx_unavailable');
    fxRate = fetched;
  }

  const memberRows = await c.var.db
    .select({ id: members.id })
    .from(members)
    .where(eq(members.groupId, group.id));
  const validMemberIds = new Set(memberRows.map((member) => member.id));
  if (!validMemberIds.has(input.payerMemberId)) throw new Error('errors.unknown_payer');
  const splits = computeSplit({
    totalMinor: amountMinor,
    rule: input.splitRule,
    payerMemberId: input.payerMemberId,
    validMemberIds,
  });
  return { amountMinor, fxRate, splits };
}

expenseRoutes.get('/groups/:groupId/ledger', async (c) => {
  const groupId = c.req.param('groupId');
  const { group } = await requireGroupAccess(c, groupId, 'READ_GROUP');
  const ledger = await loadLedger(c.var.db, group, {
    expensePage: {
      page: parsePageNumber(c.req.query('page')),
      pageSize: LEDGER_EXPENSE_PAGE_SIZE,
    },
  });
  return c.json(serializeLedger(ledger));
});

expenseRoutes.get('/groups/:groupId/expenses/:expenseId', async (c) => {
  const groupId = c.req.param('groupId');
  await requireGroupAccess(c, groupId, 'READ_GROUP');
  const [expense] = await c.var.db
    .select()
    .from(expenses)
    .where(
      and(
        eq(expenses.id, c.req.param('expenseId')),
        eq(expenses.groupId, groupId),
        isNull(expenses.deletedAt),
      ),
    )
    .limit(1);
  if (!expense) return c.json({ error: 'NOT_FOUND' }, 404);
  const splits = await c.var.db
    .select({ memberId: expenseSplits.memberId, shareMinor: expenseSplits.shareMinor })
    .from(expenseSplits)
    .where(eq(expenseSplits.expenseId, expense.id));
  return c.json({
    expense: {
      ...expense,
      occurredAt: expense.occurredAt.toISOString(),
      amountMinor: expense.amountMinor.toString(),
      createdAt: expense.createdAt.toISOString(),
      updatedAt: expense.updatedAt.toISOString(),
      splits: splits.map((split) => ({ ...split, shareMinor: split.shareMinor.toString() })),
    },
  });
});

expenseRoutes.post('/groups/:groupId/expenses', async (c) => {
  const groupId = c.req.param('groupId');
  const parsed = expenseInputSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ ok: false, error: 'errors.invalid_input' }, 400);
  const { access, group } = await requireGroupAccess(c, groupId, 'WRITE_EXPENSE');
  const constrained = boundMember(access);
  if (constrained && parsed.data.payerMemberId !== constrained) {
    return c.json({ ok: false, error: 'errors.forbidden' }, 403);
  }

  let materialized: MaterializedExpense;
  try {
    materialized = await materialize(c, group, parsed.data);
  } catch (error) {
    return c.json({ ok: false, error: inputError(error) }, 400);
  }

  const expenseId = createId();
  const writer = actor(access);
  const now = new Date();
  const revision = await c.var.db.transaction(async (tx) => {
    const groupState = await lockWritableGroup(tx, groupId);
    if (groupState !== 'active') return groupState;
    await tx.insert(expenses).values({
      id: expenseId,
      groupId,
      occurredAt: new Date(parsed.data.occurredAt),
      title: parsed.data.title,
      note: parsed.data.note || null,
      currency: parsed.data.currency,
      amountMinor: materialized.amountMinor,
      fxRateToGroupCurrency: materialized.fxRate.toString(),
      payerMemberId: parsed.data.payerMemberId,
      splitRule: parsed.data.splitRule,
      splitInputState: parsed.data.splitInputState ?? null,
      tags: parsed.data.tags,
      createdByUserId: writer.createdByUserId,
      createdByShareLinkId: writer.createdByShareLinkId,
      updatedAt: now,
    });
    if (materialized.splits.size > 0) {
      await tx.insert(expenseSplits).values(
        [...materialized.splits].map(([memberId, shareMinor]) => ({
          id: createId(),
          expenseId,
          memberId,
          shareMinor,
        })),
      );
    }
    await writeAudit(tx, {
      groupId,
      actor: auditActor(access),
      action: 'EXPENSE_CREATE',
      targetType: 'Expense',
      targetId: expenseId,
      diff: {
        title: parsed.data.title,
        currency: parsed.data.currency,
        amountMinor: materialized.amountMinor.toString(),
        payerMemberId: parsed.data.payerMemberId,
      },
    });
    return bumpGroupRevision(tx, groupId);
  });
  if (revision === 'missing') return c.json({ ok: false, error: 'errors.not_found' }, 404);
  if (revision === 'archived') {
    return c.json({ ok: false, error: 'errors.expense_locked' }, 409);
  }
  scheduleGroupEvent(c, groupId, {
    revision,
    type: 'expense.created',
    entityId: expenseId,
    actorId: writer.auditId,
  });
  return c.json({ ok: true, expenseId, version: 1, revision }, 201);
});

expenseRoutes.put('/groups/:groupId/expenses/:expenseId', async (c) => {
  const groupId = c.req.param('groupId');
  const expenseId = c.req.param('expenseId');
  const parsed = updateExpenseInputSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ ok: false, error: 'errors.invalid_input' }, 400);
  const { access, group } = await requireGroupAccess(c, groupId, 'WRITE_EXPENSE');
  const [existing] = await c.var.db
    .select({
      title: expenses.title,
      currency: expenses.currency,
      amountMinor: expenses.amountMinor,
      payerMemberId: expenses.payerMemberId,
      lockedBySettlementId: expenses.lockedBySettlementId,
      version: expenses.version,
    })
    .from(expenses)
    .where(
      and(eq(expenses.id, expenseId), eq(expenses.groupId, groupId), isNull(expenses.deletedAt)),
    )
    .limit(1);
  if (!existing) return c.json({ ok: false, error: 'errors.not_found' }, 404);
  if (existing.lockedBySettlementId) {
    return c.json({ ok: false, error: 'errors.expense_locked' }, 409);
  }
  const constrained = boundMember(access);
  if (
    constrained &&
    (existing.payerMemberId !== constrained || parsed.data.payerMemberId !== constrained)
  ) {
    return c.json({ ok: false, error: 'errors.forbidden' }, 403);
  }

  let materialized: MaterializedExpense;
  try {
    materialized = await materialize(c, group, parsed.data);
  } catch (error) {
    return c.json({ ok: false, error: inputError(error) }, 400);
  }
  const writer = actor(access);
  const result = await c.var.db.transaction(async (tx) => {
    const groupState = await lockWritableGroup(tx, groupId);
    if (groupState !== 'active') return groupState;
    const updated = await tx
      .update(expenses)
      .set({
        occurredAt: new Date(parsed.data.occurredAt),
        title: parsed.data.title,
        note: parsed.data.note || null,
        currency: parsed.data.currency,
        amountMinor: materialized.amountMinor,
        fxRateToGroupCurrency: materialized.fxRate.toString(),
        payerMemberId: parsed.data.payerMemberId,
        splitRule: parsed.data.splitRule,
        splitInputState: parsed.data.splitInputState ?? null,
        tags: parsed.data.tags,
        updatedAt: new Date(),
        version: sql`${expenses.version} + 1`,
      })
      .where(
        and(
          eq(expenses.id, expenseId),
          eq(expenses.groupId, groupId),
          eq(expenses.version, parsed.data.expectedVersion),
          isNull(expenses.deletedAt),
          isNull(expenses.lockedBySettlementId),
        ),
      )
      .returning({ version: expenses.version });
    if (updated.length === 0) return null;
    await tx.delete(expenseSplits).where(eq(expenseSplits.expenseId, expenseId));
    if (materialized.splits.size > 0) {
      await tx.insert(expenseSplits).values(
        [...materialized.splits].map(([memberId, shareMinor]) => ({
          id: createId(),
          expenseId,
          memberId,
          shareMinor,
        })),
      );
    }
    await writeAudit(tx, {
      groupId,
      actor: auditActor(access),
      action: 'EXPENSE_UPDATE',
      targetType: 'Expense',
      targetId: expenseId,
      diff: {
        title: { before: existing.title, after: parsed.data.title },
        currency: { before: existing.currency, after: parsed.data.currency },
        amountMinor: {
          before: existing.amountMinor.toString(),
          after: materialized.amountMinor.toString(),
        },
        payerMemberId: { before: existing.payerMemberId, after: parsed.data.payerMemberId },
      },
    });
    return { version: updated[0]!.version, revision: await bumpGroupRevision(tx, groupId) };
  });
  if (result === 'missing') return c.json({ ok: false, error: 'errors.not_found' }, 404);
  if (result === 'archived') {
    return c.json({ ok: false, error: 'errors.expense_locked' }, 409);
  }
  if (!result) {
    return c.json({ ok: false, error: 'errors.conflict', currentVersion: existing.version }, 409);
  }
  scheduleGroupEvent(c, groupId, {
    revision: result.revision,
    type: 'expense.updated',
    entityId: expenseId,
    actorId: writer.auditId,
  });
  return c.json({ ok: true, expenseId, ...result });
});

expenseRoutes.delete('/groups/:groupId/expenses/:expenseId', async (c) => {
  const groupId = c.req.param('groupId');
  const expenseId = c.req.param('expenseId');
  const { access } = await requireGroupAccess(c, groupId, 'WRITE_EXPENSE');
  const [existing] = await c.var.db
    .select({
      title: expenses.title,
      currency: expenses.currency,
      amountMinor: expenses.amountMinor,
      payerMemberId: expenses.payerMemberId,
      lockedBySettlementId: expenses.lockedBySettlementId,
      version: expenses.version,
    })
    .from(expenses)
    .where(
      and(eq(expenses.id, expenseId), eq(expenses.groupId, groupId), isNull(expenses.deletedAt)),
    )
    .limit(1);
  if (!existing) return c.json({ ok: false, error: 'errors.not_found' }, 404);
  if (existing.lockedBySettlementId)
    return c.json({ ok: false, error: 'errors.expense_locked' }, 409);
  const constrained = boundMember(access);
  if (constrained && existing.payerMemberId !== constrained) {
    return c.json({ ok: false, error: 'errors.forbidden' }, 403);
  }
  const requestedVersion = Number(
    c.req.header('if-match')?.replaceAll('"', '') ?? existing.version,
  );
  const writer = actor(access);
  const result = await c.var.db.transaction(async (tx) => {
    const groupState = await lockWritableGroup(tx, groupId);
    if (groupState !== 'active') return groupState;
    const deleted = await tx
      .update(expenses)
      .set({ deletedAt: new Date(), updatedAt: new Date(), version: sql`${expenses.version} + 1` })
      .where(
        and(
          eq(expenses.id, expenseId),
          eq(
            expenses.version,
            Number.isInteger(requestedVersion) ? requestedVersion : existing.version,
          ),
          isNull(expenses.deletedAt),
          isNull(expenses.lockedBySettlementId),
        ),
      )
      .returning({ version: expenses.version });
    if (deleted.length === 0) return null;
    await writeAudit(tx, {
      groupId,
      actor: auditActor(access),
      action: 'EXPENSE_DELETE',
      targetType: 'Expense',
      targetId: expenseId,
      diff: {
        title: existing.title,
        currency: existing.currency,
        amountMinor: existing.amountMinor.toString(),
        payerMemberId: existing.payerMemberId,
      },
    });
    return { version: deleted[0]!.version, revision: await bumpGroupRevision(tx, groupId) };
  });
  if (result === 'missing') return c.json({ ok: false, error: 'errors.not_found' }, 404);
  if (result === 'archived') {
    return c.json({ ok: false, error: 'errors.expense_locked' }, 409);
  }
  if (!result) return c.json({ ok: false, error: 'errors.conflict' }, 409);
  scheduleGroupEvent(c, groupId, {
    revision: result.revision,
    type: 'expense.deleted',
    entityId: expenseId,
    actorId: writer.auditId,
  });
  return c.json({ ok: true, ...result });
});
