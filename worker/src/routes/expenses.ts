import {
  expenseInputSchema,
  fillDraftsSchema,
  updateExpenseInputSchema,
  type ExpenseInput,
} from '@aaeasy/contracts';
import { computeSplit, parseAmountToMinor, SplitError } from '@aaeasy/core';
import { auditLogs, expenseSplits, expenses, groups, members } from '@aaeasy/db/schema';
import { createId } from '@paralleldrive/cuid2';
import Decimal from 'decimal.js';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import type { AppEnv } from '../app-env';
import { requireGroupAccess, type GroupAccess } from '../auth/access';
import { bumpGroupRevision, scheduleGroupEvent } from '../realtime/events';
import { getFxRate } from '../services/fx';
import { loadLedger, serializeLedger } from '../services/ledger';

export const expenseRoutes = new Hono<AppEnv>();

type MaterializedExpense = {
  amountMinor: bigint;
  fxRate: Decimal;
  splits: Map<string, bigint>;
};

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

function boundMember(access: GroupAccess): string | null {
  if (access.kind === 'share') return access.boundMemberId;
  return access.role === 'MEMBER' ? access.linkedMemberId : null;
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
  groupId: string,
  input: ExpenseInput,
): Promise<MaterializedExpense> {
  if (!input.amount) throw new Error('errors.invalid_amount');
  if (!input.splitRule) throw new Error('errors.invalid_input');
  const amountMinor = parseAmountToMinor(input.amount, input.currency);
  const [group] = await c.var.db
    .select({ defaultCurrency: groups.defaultCurrency, status: groups.status })
    .from(groups)
    .where(eq(groups.id, groupId))
    .limit(1);
  if (!group) throw new Error('errors.not_found');
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
    .where(eq(members.groupId, groupId));
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
  await requireGroupAccess(c, groupId, 'READ_GROUP');
  const ledger = await loadLedger(c.var.db, groupId);
  if (!ledger) return c.json({ error: 'NOT_FOUND' }, 404);
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
      amountMinor: expense.amountMinor?.toString() ?? null,
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
  const access = await requireGroupAccess(c, groupId, 'WRITE_EXPENSE');
  const constrained = boundMember(access);
  if (constrained && parsed.data.payerMemberId !== constrained) {
    return c.json({ ok: false, error: 'errors.forbidden' }, 403);
  }

  let materialized: MaterializedExpense | null = null;
  try {
    if (parsed.data.isDraft) {
      const [payer] = await c.var.db
        .select({ id: members.id })
        .from(members)
        .where(and(eq(members.id, parsed.data.payerMemberId), eq(members.groupId, groupId)))
        .limit(1);
      if (!payer) return c.json({ ok: false, error: 'errors.unknown_payer' }, 400);
      const [group] = await c.var.db
        .select({ status: groups.status })
        .from(groups)
        .where(eq(groups.id, groupId))
        .limit(1);
      if (group?.status === 'ARCHIVED') {
        return c.json({ ok: false, error: 'errors.expense_locked' }, 409);
      }
    } else {
      materialized = await materialize(c, groupId, parsed.data);
    }
  } catch (error) {
    return c.json({ ok: false, error: inputError(error) }, 400);
  }

  const expenseId = createId();
  const auditActor = actor(access);
  const now = new Date();
  const revision = await c.var.db.transaction(async (tx) => {
    await tx.insert(expenses).values({
      id: expenseId,
      groupId,
      occurredAt: new Date(parsed.data.occurredAt),
      title: parsed.data.title,
      note: parsed.data.note || null,
      currency: parsed.data.currency,
      amountMinor: materialized?.amountMinor ?? null,
      fxRateToGroupCurrency: materialized?.fxRate.toString() ?? null,
      payerMemberId: parsed.data.payerMemberId,
      splitRule: parsed.data.isDraft ? null : parsed.data.splitRule,
      splitInputState: parsed.data.isDraft ? null : (parsed.data.splitInputState ?? null),
      tags: parsed.data.tags,
      isDraft: parsed.data.isDraft,
      createdByUserId: auditActor.createdByUserId,
      createdByShareLinkId: auditActor.createdByShareLinkId,
      updatedAt: now,
    });
    if (materialized && materialized.splits.size > 0) {
      await tx.insert(expenseSplits).values(
        [...materialized.splits].map(([memberId, shareMinor]) => ({
          id: createId(),
          expenseId,
          memberId,
          shareMinor,
        })),
      );
    }
    await tx.insert(auditLogs).values({
      id: createId(),
      groupId,
      actorType: auditActor.auditType,
      actorId: auditActor.auditId,
      action: parsed.data.isDraft ? 'EXPENSE_CREATE_DRAFT' : 'EXPENSE_CREATE',
      targetType: 'Expense',
      targetId: expenseId,
    });
    return bumpGroupRevision(tx, groupId);
  });
  scheduleGroupEvent(c, groupId, {
    revision,
    type: 'expense.created',
    entityId: expenseId,
    actorId: auditActor.auditId,
  });
  return c.json({ ok: true, expenseId, version: 1, revision }, 201);
});

expenseRoutes.put('/groups/:groupId/expenses/:expenseId', async (c) => {
  const groupId = c.req.param('groupId');
  const expenseId = c.req.param('expenseId');
  const parsed = updateExpenseInputSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ ok: false, error: 'errors.invalid_input' }, 400);
  const [existing] = await c.var.db
    .select({
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
  const access = await requireGroupAccess(c, groupId, 'WRITE_EXPENSE');
  const constrained = boundMember(access);
  if (
    constrained &&
    (existing.payerMemberId !== constrained || parsed.data.payerMemberId !== constrained)
  ) {
    return c.json({ ok: false, error: 'errors.forbidden' }, 403);
  }

  let materialized: MaterializedExpense | null = null;
  try {
    if (!parsed.data.isDraft) materialized = await materialize(c, groupId, parsed.data);
  } catch (error) {
    return c.json({ ok: false, error: inputError(error) }, 400);
  }
  const auditActor = actor(access);
  const result = await c.var.db.transaction(async (tx) => {
    const updated = await tx
      .update(expenses)
      .set({
        occurredAt: new Date(parsed.data.occurredAt),
        title: parsed.data.title,
        note: parsed.data.note || null,
        currency: parsed.data.currency,
        amountMinor: materialized?.amountMinor ?? null,
        fxRateToGroupCurrency: materialized?.fxRate.toString() ?? null,
        payerMemberId: parsed.data.payerMemberId,
        splitRule: parsed.data.isDraft ? null : parsed.data.splitRule,
        splitInputState: parsed.data.isDraft ? null : (parsed.data.splitInputState ?? null),
        tags: parsed.data.tags,
        isDraft: parsed.data.isDraft,
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
    if (materialized && materialized.splits.size > 0) {
      await tx.insert(expenseSplits).values(
        [...materialized.splits].map(([memberId, shareMinor]) => ({
          id: createId(),
          expenseId,
          memberId,
          shareMinor,
        })),
      );
    }
    await tx.insert(auditLogs).values({
      id: createId(),
      groupId,
      actorType: auditActor.auditType,
      actorId: auditActor.auditId,
      action: 'EXPENSE_UPDATE',
      targetType: 'Expense',
      targetId: expenseId,
    });
    return { version: updated[0]!.version, revision: await bumpGroupRevision(tx, groupId) };
  });
  if (!result) {
    return c.json({ ok: false, error: 'errors.conflict', currentVersion: existing.version }, 409);
  }
  scheduleGroupEvent(c, groupId, {
    revision: result.revision,
    type: 'expense.updated',
    entityId: expenseId,
    actorId: auditActor.auditId,
  });
  return c.json({ ok: true, expenseId, ...result });
});

expenseRoutes.delete('/groups/:groupId/expenses/:expenseId', async (c) => {
  const groupId = c.req.param('groupId');
  const expenseId = c.req.param('expenseId');
  const [existing] = await c.var.db
    .select({
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
  const access = await requireGroupAccess(c, groupId, 'WRITE_EXPENSE');
  const constrained = boundMember(access);
  if (constrained && existing.payerMemberId !== constrained) {
    return c.json({ ok: false, error: 'errors.forbidden' }, 403);
  }
  const requestedVersion = Number(
    c.req.header('if-match')?.replaceAll('"', '') ?? existing.version,
  );
  const auditActor = actor(access);
  const result = await c.var.db.transaction(async (tx) => {
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
        ),
      )
      .returning({ version: expenses.version });
    if (deleted.length === 0) return null;
    await tx.insert(auditLogs).values({
      id: createId(),
      groupId,
      actorType: auditActor.auditType,
      actorId: auditActor.auditId,
      action: 'EXPENSE_DELETE',
      targetType: 'Expense',
      targetId: expenseId,
    });
    return { version: deleted[0]!.version, revision: await bumpGroupRevision(tx, groupId) };
  });
  if (!result) return c.json({ ok: false, error: 'errors.conflict' }, 409);
  scheduleGroupEvent(c, groupId, {
    revision: result.revision,
    type: 'expense.deleted',
    entityId: expenseId,
    actorId: auditActor.auditId,
  });
  return c.json({ ok: true, ...result });
});

expenseRoutes.post('/groups/:groupId/expenses/fill-drafts', async (c) => {
  const groupId = c.req.param('groupId');
  const parsed = fillDraftsSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ ok: false, error: 'errors.invalid_input' }, 400);
  const access = await requireGroupAccess(c, groupId, 'WRITE_EXPENSE');
  const constrained = boundMember(access);
  const [group] = await c.var.db
    .select({ defaultCurrency: groups.defaultCurrency, status: groups.status })
    .from(groups)
    .where(eq(groups.id, groupId))
    .limit(1);
  if (!group || group.status === 'ARCHIVED') {
    return c.json({ ok: false, error: 'errors.expense_locked' }, 409);
  }
  const memberRows = await c.var.db
    .select({ id: members.id })
    .from(members)
    .where(eq(members.groupId, groupId));
  const memberIds = memberRows.map((member) => member.id);
  const validIds = new Set(memberIds);
  const draftRows = await c.var.db
    .select()
    .from(expenses)
    .where(
      and(
        eq(expenses.groupId, groupId),
        inArray(
          expenses.id,
          parsed.data.items.map((item) => item.expenseId),
        ),
        isNull(expenses.deletedAt),
      ),
    );
  const draftsById = new Map(draftRows.map((draft) => [draft.id, draft]));
  const auditActor = actor(access);
  const filled: string[] = [];
  const failed: Array<{ expenseId: string; error: string }> = [];

  for (const item of parsed.data.items) {
    const draft = draftsById.get(item.expenseId);
    if (!draft) {
      failed.push({ expenseId: item.expenseId, error: 'errors.not_found' });
      continue;
    }
    if (!draft.isDraft) {
      failed.push({ expenseId: item.expenseId, error: 'errors.not_draft' });
      continue;
    }
    if (draft.lockedBySettlementId) {
      failed.push({ expenseId: item.expenseId, error: 'errors.expense_locked' });
      continue;
    }
    if (constrained && draft.payerMemberId !== constrained) {
      failed.push({ expenseId: item.expenseId, error: 'errors.forbidden' });
      continue;
    }

    try {
      const amountMinor = parseAmountToMinor(item.amount, draft.currency);
      if (amountMinor <= 0n) throw new Error('AMOUNT_NEGATIVE');
      const fxRate =
        draft.currency === group.defaultCurrency
          ? new Decimal(1)
          : await getFxRate(c.var.db, {
              base: draft.currency,
              quote: group.defaultCurrency,
              date: draft.occurredAt,
            });
      if (!fxRate) throw new Error('errors.fx_unavailable');
      const rule = { type: 'EQUAL' as const, memberIds };
      const splits = computeSplit({
        totalMinor: amountMinor,
        rule,
        payerMemberId: draft.payerMemberId,
        validMemberIds: validIds,
      });
      const result = await c.var.db.transaction(async (tx) => {
        const updated = await tx
          .update(expenses)
          .set({
            amountMinor,
            fxRateToGroupCurrency: fxRate.toString(),
            splitRule: rule,
            splitInputState: {
              rows: memberIds.map((memberId) => ({
                memberId,
                checked: true,
                shares: '1',
                extraText: '',
              })),
            },
            isDraft: false,
            updatedAt: new Date(),
            version: sql`${expenses.version} + 1`,
          })
          .where(
            and(
              eq(expenses.id, draft.id),
              eq(expenses.version, draft.version),
              eq(expenses.isDraft, true),
              isNull(expenses.deletedAt),
              isNull(expenses.lockedBySettlementId),
            ),
          )
          .returning({ version: expenses.version });
        if (updated.length === 0) return null;
        await tx.delete(expenseSplits).where(eq(expenseSplits.expenseId, draft.id));
        await tx.insert(expenseSplits).values(
          [...splits].map(([memberId, shareMinor]) => ({
            id: createId(),
            expenseId: draft.id,
            memberId,
            shareMinor,
          })),
        );
        await tx.insert(auditLogs).values({
          id: createId(),
          groupId,
          actorType: auditActor.auditType,
          actorId: auditActor.auditId,
          action: 'EXPENSE_FILL_DRAFT',
          targetType: 'Expense',
          targetId: draft.id,
        });
        return { revision: await bumpGroupRevision(tx, groupId) };
      });
      if (!result) throw new Error('errors.conflict');
      filled.push(draft.id);
      scheduleGroupEvent(c, groupId, {
        revision: result.revision,
        type: 'expense.updated',
        entityId: draft.id,
        actorId: auditActor.auditId,
      });
    } catch (error) {
      failed.push({ expenseId: item.expenseId, error: inputError(error) });
    }
  }

  if (filled.length === 0) {
    return c.json({ ok: false, error: failed[0]?.error ?? 'errors.unknown', failed }, 400);
  }
  return c.json({ ok: true, filled, ...(failed.length ? { failed } : {}) });
});
