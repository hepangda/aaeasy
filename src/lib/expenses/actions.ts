'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import Decimal from 'decimal.js';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireGroupAccess, AccessError } from '@/lib/auth/group-access';
import { parseAmountToMinor, isCurrencyCode } from '@/lib/money';
import { computeSplit, SplitError } from '@/lib/split';
import { splitRuleSchema } from '@/lib/split/types';
import { getFxRate } from '@/lib/fx';
import { publish } from '@/lib/realtime/pgNotify';

// ─── Types ───────────────────────────────────────────────────────────────

export type ExpenseActionState = {
  ok: boolean;
  error?: string;
  expenseId?: string;
};

// ─── Schemas ─────────────────────────────────────────────────────────────

/**
 * Inputs that are required even for a DRAFT (where the payer hasn't filled
 * in the amount yet). The payer + currency + title are needed to identify
 * the expense; the amount/split are optional placeholders.
 */
const baseExpenseSchema = z.object({
  groupId: z.string().min(1),
  occurredAt: z.coerce.date(),
  title: z.string().trim().min(1).max(120),
  note: z.string().max(2_000).optional().or(z.literal('')),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .refine(isCurrencyCode, { message: 'errors.invalid_currency' }),
  amount: z.string().optional().or(z.literal('')), // free-form, parsed in lib/money
  payerMemberId: z.string().min(1),
  /** Manual rate override: amount in `currency` × rate = amount in groupCurrency. */
  fxRateOverride: z.string().optional().or(z.literal('')),
  splitRule: splitRuleSchema.nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  isDraft: z.boolean().optional().default(false),
});

const createSchema = baseExpenseSchema;
const updateSchema = baseExpenseSchema.extend({
  expenseId: z.string().min(1),
});

const fillDraftsSchema = z.object({
  groupId: z.string().min(1),
  /** One per draft expense the caller is filling in. */
  items: z
    .array(
      z.object({
        expenseId: z.string().min(1),
        amount: z.string().min(1, { message: 'errors.invalid_amount' }),
      }),
    )
    .min(1, { message: 'errors.invalid_input' })
    .max(50, { message: 'errors.invalid_input' }),
});

// ─── Internal helpers ────────────────────────────────────────────────────

interface MaterializedExpense {
  amountMinor: bigint;
  fxRate: Decimal;
  splits: Map<string, bigint>;
}

async function materialize(input: z.infer<typeof baseExpenseSchema>): Promise<MaterializedExpense> {
  if (!input.amount) throw new Error('errors.invalid_amount');
  if (!input.splitRule) throw new Error('errors.invalid_input');
  const amountMinor = parseAmountToMinor(input.amount, input.currency);

  // Fetch group's default currency to know the FX target.
  const group = await prisma.group.findUniqueOrThrow({
    where: { id: input.groupId },
    select: { defaultCurrency: true },
  });

  let fxRate: Decimal;
  if (input.currency === group.defaultCurrency) {
    fxRate = new Decimal(1);
  } else if (input.fxRateOverride && input.fxRateOverride.trim()) {
    const r = new Decimal(input.fxRateOverride.trim());
    if (!r.isFinite() || r.lte(0)) throw new Error('errors.invalid_fx_rate');
    fxRate = r;
  } else {
    const fetched = await getFxRate({
      base: input.currency,
      quote: group.defaultCurrency,
      date: input.occurredAt,
    });
    if (!fetched) throw new Error('errors.fx_unavailable');
    fxRate = fetched;
  }

  // Validate that all members referenced exist in the group.
  const members = await prisma.member.findMany({
    where: { groupId: input.groupId },
    select: { id: true },
  });
  const validIds = new Set(members.map((m) => m.id));
  if (!validIds.has(input.payerMemberId)) throw new Error('errors.unknown_payer');

  const splits = computeSplit({
    totalMinor: amountMinor,
    rule: input.splitRule,
    payerMemberId: input.payerMemberId,
    validMemberIds: validIds,
  });

  return { amountMinor, fxRate, splits };
}

/** Resolve the FX rate for a draft fill. Mirrors `materialize` but only the
 *  rate part — used by the one-click fill flow which has no override input. */
async function resolveFxRateForFill(opts: {
  groupCurrency: string;
  expenseCurrency: string;
  occurredAt: Date;
}): Promise<Decimal> {
  if (opts.expenseCurrency === opts.groupCurrency) return new Decimal(1);
  const fetched = await getFxRate({
    base: opts.expenseCurrency,
    quote: opts.groupCurrency,
    date: opts.occurredAt,
  });
  if (!fetched) throw new Error('errors.fx_unavailable');
  return fetched;
}

function actorFor(access: Awaited<ReturnType<typeof requireGroupAccess>>) {
  if (access.kind === 'user') {
    return {
      createdByUserId: access.userId,
      createdByShareLinkId: null,
      auditActor: { type: 'USER' as const, id: access.userId },
    };
  }
  return {
    createdByUserId: null,
    createdByShareLinkId: access.shareLinkId,
    auditActor: { type: 'SHARE' as const, id: access.shareLinkId },
  };
}

// ─── Actions ─────────────────────────────────────────────────────────────

export async function createExpenseAction(
  _prev: ExpenseActionState,
  formData: FormData,
): Promise<ExpenseActionState> {
  const raw = parseFormData(formData);
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: firstZodKey(parsed.error) };
  }

  const access = await requireGroupAccess(parsed.data.groupId, 'WRITE_EXPENSE');

  // Constraint enforcement: writers whose access is bound to a single
  // member can only create expenses where that member is the payer.
  // Applies to both share visitors (boundMemberId) and signed-in users
  // with role=MEMBER (linkedMemberId).
  const boundTo =
    access.kind === 'share'
      ? access.boundMemberId
      : access.role === 'MEMBER'
        ? access.linkedMemberId
        : null;
  if (boundTo !== null && parsed.data.payerMemberId !== boundTo) {
    return { ok: false, error: 'errors.forbidden' };
  }

  // Validate the payer exists in the group even for drafts (we don't run
  // materialize() in draft mode otherwise).
  if (parsed.data.isDraft) {
    const exists = await prisma.member.count({
      where: { id: parsed.data.payerMemberId, groupId: parsed.data.groupId },
    });
    if (!exists) return { ok: false, error: 'errors.unknown_payer' };
  }

  let mat: MaterializedExpense | null = null;
  if (!parsed.data.isDraft) {
    try {
      mat = await materialize(parsed.data);
    } catch (e) {
      return { ok: false, error: extractCode(e) };
    }
  }

  const actor = actorFor(access);

  const expense = await prisma.$transaction(async (tx) => {
    const e = await tx.expense.create({
      data: {
        groupId: parsed.data.groupId,
        occurredAt: parsed.data.occurredAt,
        title: parsed.data.title,
        note: parsed.data.note || null,
        currency: parsed.data.currency,
        amountMinor: mat?.amountMinor ?? null,
        fxRateToGroupCurrency: mat
          ? new Prisma.Decimal(mat.fxRate.toString())
          : null,
        payerMemberId: parsed.data.payerMemberId,
        splitRule: parsed.data.isDraft
          ? Prisma.JsonNull
          : (parsed.data.splitRule as Prisma.InputJsonValue),
        tags: parsed.data.tags ?? [],
        isDraft: parsed.data.isDraft,
        createdByUserId: actor.createdByUserId,
        createdByShareLinkId: actor.createdByShareLinkId,
        splits: mat
          ? {
              create: Array.from(mat.splits, ([memberId, shareMinor]) => ({
                memberId,
                shareMinor,
              })),
            }
          : undefined,
      },
      select: { id: true },
    });
    await tx.auditLog.create({
      data: {
        groupId: parsed.data.groupId,
        actorType: actor.auditActor.type,
        actorId: actor.auditActor.id,
        action: parsed.data.isDraft ? 'EXPENSE_CREATE_DRAFT' : 'EXPENSE_CREATE',
        targetType: 'Expense',
        targetId: e.id,
      },
    });
    return e;
  });

  revalidatePath(`/groups/${parsed.data.groupId}`);
  await publish({
    type: 'EXPENSE_CREATED',
    groupId: parsed.data.groupId,
    expenseId: expense.id,
  }).catch(() => {});
  return { ok: true, expenseId: expense.id };
}

export async function updateExpenseAction(
  _prev: ExpenseActionState,
  formData: FormData,
): Promise<ExpenseActionState> {
  const raw = parseFormData(formData);
  raw.expenseId = formData.get('expenseId')?.toString() ?? '';
  const parsed = updateSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: firstZodKey(parsed.error) };
  }

  const existing = await prisma.expense.findUnique({
    where: { id: parsed.data.expenseId },
    select: {
      groupId: true,
      lockedBySettlementId: true,
      deletedAt: true,
      payerMemberId: true,
      isDraft: true,
    },
  });
  if (!existing || existing.deletedAt) return { ok: false, error: 'errors.not_found' };
  if (existing.groupId !== parsed.data.groupId) return { ok: false, error: 'errors.not_found' };
  if (existing.lockedBySettlementId) return { ok: false, error: 'errors.expense_locked' };

  const access = await requireGroupAccess(parsed.data.groupId, 'WRITE_EXPENSE');

  // Bound writers (share boundMemberId, or MEMBER role linkedMemberId)
  // can only edit expenses they "own": both the existing row's payer
  // AND the new payer must equal the bound member.
  const boundTo =
    access.kind === 'share'
      ? access.boundMemberId
      : access.role === 'MEMBER'
        ? access.linkedMemberId
        : null;
  if (
    boundTo !== null &&
    (existing.payerMemberId !== boundTo ||
      parsed.data.payerMemberId !== boundTo)
  ) {
    return { ok: false, error: 'errors.forbidden' };
  }

  let mat: MaterializedExpense | null = null;
  if (!parsed.data.isDraft) {
    try {
      mat = await materialize(parsed.data);
    } catch (e) {
      return { ok: false, error: extractCode(e) };
    }
  }

  const actor = actorFor(access);

  await prisma.$transaction(async (tx) => {
    await tx.expenseSplit.deleteMany({ where: { expenseId: parsed.data.expenseId } });
    await tx.expense.update({
      where: { id: parsed.data.expenseId },
      data: {
        occurredAt: parsed.data.occurredAt,
        title: parsed.data.title,
        note: parsed.data.note || null,
        currency: parsed.data.currency,
        amountMinor: mat?.amountMinor ?? null,
        fxRateToGroupCurrency: mat
          ? new Prisma.Decimal(mat.fxRate.toString())
          : null,
        payerMemberId: parsed.data.payerMemberId,
        splitRule: parsed.data.isDraft
          ? Prisma.JsonNull
          : (parsed.data.splitRule as Prisma.InputJsonValue),
        tags: parsed.data.tags ?? [],
        isDraft: parsed.data.isDraft,
        splits: mat
          ? {
              create: Array.from(mat.splits, ([memberId, shareMinor]) => ({
                memberId,
                shareMinor,
              })),
            }
          : undefined,
      },
    });
    await tx.auditLog.create({
      data: {
        groupId: parsed.data.groupId,
        actorType: actor.auditActor.type,
        actorId: actor.auditActor.id,
        action: 'EXPENSE_UPDATE',
        targetType: 'Expense',
        targetId: parsed.data.expenseId,
      },
    });
  });

  revalidatePath(`/groups/${parsed.data.groupId}`);
  await publish({
    type: 'EXPENSE_UPDATED',
    groupId: parsed.data.groupId,
    expenseId: parsed.data.expenseId,
  }).catch(() => {});
  return { ok: true, expenseId: parsed.data.expenseId };
}

export async function softDeleteExpenseAction(input: {
  groupId: string;
  expenseId: string;
}): Promise<ExpenseActionState> {
  const existing = await prisma.expense.findUnique({
    where: { id: input.expenseId },
    select: { groupId: true, lockedBySettlementId: true, deletedAt: true, payerMemberId: true },
  });
  if (!existing || existing.deletedAt) return { ok: false, error: 'errors.not_found' };
  if (existing.groupId !== input.groupId) return { ok: false, error: 'errors.not_found' };
  if (existing.lockedBySettlementId) return { ok: false, error: 'errors.expense_locked' };

  const access = await requireGroupAccess(input.groupId, 'WRITE_EXPENSE');

  // Bound writers (share boundMemberId, or MEMBER role linkedMemberId)
  // can only delete expenses where they are the payer.
  const boundTo =
    access.kind === 'share'
      ? access.boundMemberId
      : access.role === 'MEMBER'
        ? access.linkedMemberId
        : null;
  if (boundTo !== null && existing.payerMemberId !== boundTo) {
    return { ok: false, error: 'errors.forbidden' };
  }

  const actor = actorFor(access);

  await prisma.$transaction(async (tx) => {
    await tx.expense.update({
      where: { id: input.expenseId },
      data: { deletedAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        groupId: input.groupId,
        actorType: actor.auditActor.type,
        actorId: actor.auditActor.id,
        action: 'EXPENSE_DELETE',
        targetType: 'Expense',
        targetId: input.expenseId,
      },
    });
  });

  revalidatePath(`/groups/${input.groupId}`);
  await publish({
    type: 'EXPENSE_DELETED',
    groupId: input.groupId,
    expenseId: input.expenseId,
  }).catch(() => {});
  return { ok: true };
}

// ─── Helpers ─────────────────────────────────────────────────────────────

/** Pulls the typed inputs out of FormData. The split rule is JSON-encoded. */
function parseFormData(form: FormData): Record<string, unknown> {
  const splitRuleRaw = form.get('splitRule')?.toString();
  let splitRule: unknown = undefined;
  if (splitRuleRaw) {
    try {
      splitRule = JSON.parse(splitRuleRaw);
    } catch {
      splitRule = null;
    }
  }
  const tagsRaw = form.get('tags')?.toString();
  const tags = tagsRaw
    ? tagsRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;
  return {
    groupId: form.get('groupId')?.toString() ?? '',
    occurredAt: form.get('occurredAt')?.toString() ?? new Date().toISOString(),
    title: form.get('title')?.toString() ?? '',
    note: form.get('note')?.toString() ?? '',
    currency: form.get('currency')?.toString() ?? '',
    amount: form.get('amount')?.toString() ?? '',
    payerMemberId: form.get('payerMemberId')?.toString() ?? '',
    fxRateOverride: form.get('fxRateOverride')?.toString() ?? '',
    splitRule,
    tags,
    isDraft: form.get('isDraft')?.toString() === 'true',
  };
}

function extractCode(e: unknown): string {
  if (e instanceof AccessError) return 'errors.forbidden';
  if (e instanceof SplitError) return `errors.split_${e.code.toLowerCase()}`;
  if (e instanceof Error) {
    if (e.message.startsWith('errors.')) return e.message;
    if (e.message === 'AMOUNT_INVALID' || e.message === 'AMOUNT_EMPTY') return 'errors.invalid_amount';
    if (e.message === 'AMOUNT_NEGATIVE') return 'errors.amount_negative';
    return 'errors.unknown';
  }
  return 'errors.unknown';
}

/** Pull the first issue message out of a zod ZodError. Only forwards strings
 *  that look like i18n keys (`errors.*`); anything else (zod's built-in
 *  English fallbacks like "Too small: expected array to have >=1 items")
 *  collapses to a generic key so the toast layer can translate it. */
function firstZodKey(err: z.ZodError, fallback = 'errors.invalid_input'): string {
  const m = err.issues[0]?.message;
  if (typeof m === 'string' && m.startsWith('errors.')) return m;
  return fallback;
}

// ─── Draft fill (one-click batch) ────────────────────────────────────────────

export type FillDraftsState = {
  ok: boolean;
  error?: string;
  /** expenseIds that successfully transitioned out of draft state. */
  filled?: string[];
  /** Per-item failures keyed by expenseId. */
  failed?: Array<{ expenseId: string; error: string }>;
};

/**
 * Convert one or more DRAFT expenses into materialized expenses by giving
 * each an amount. Splits are applied EQUALLY across all current group
 * members, since this entry point is meant for the payer's quick fill on
 * the group page — advanced splits remain available via the edit page.
 *
 * Per-row failures are reported in `failed` instead of aborting the whole
 * batch. The action only returns `ok: false` when nothing could be saved.
 */
export async function fillDraftsAction(
  input: z.infer<typeof fillDraftsSchema>,
): Promise<FillDraftsState> {
  const parsed = fillDraftsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: firstZodKey(parsed.error) };
  }

  const access = await requireGroupAccess(parsed.data.groupId, 'WRITE_EXPENSE');

  const boundTo =
    access.kind === 'share'
      ? access.boundMemberId
      : access.role === 'MEMBER'
        ? access.linkedMemberId
        : null;

  const [group, members, drafts] = await Promise.all([
    prisma.group.findUniqueOrThrow({
      where: { id: parsed.data.groupId },
      select: { defaultCurrency: true },
    }),
    prisma.member.findMany({
      where: { groupId: parsed.data.groupId },
      select: { id: true },
    }),
    prisma.expense.findMany({
      where: {
        groupId: parsed.data.groupId,
        id: { in: parsed.data.items.map((i) => i.expenseId) },
        deletedAt: null,
      },
      select: {
        id: true,
        currency: true,
        occurredAt: true,
        payerMemberId: true,
        isDraft: true,
        lockedBySettlementId: true,
      },
    }),
  ]);
  const validIds = new Set(members.map((m) => m.id));
  const memberIds = members.map((m) => m.id);
  const draftById = new Map(drafts.map((d) => [d.id, d]));

  const actor = actorFor(access);
  const filled: string[] = [];
  const failed: Array<{ expenseId: string; error: string }> = [];

  for (const item of parsed.data.items) {
    const draft = draftById.get(item.expenseId);
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
    if (boundTo !== null && draft.payerMemberId !== boundTo) {
      failed.push({ expenseId: item.expenseId, error: 'errors.forbidden' });
      continue;
    }

    let amountMinor: bigint;
    try {
      amountMinor = parseAmountToMinor(item.amount, draft.currency);
      if (amountMinor <= 0n) throw new Error('AMOUNT_NEGATIVE');
    } catch (e) {
      failed.push({ expenseId: item.expenseId, error: extractCode(e) });
      continue;
    }

    let fxRate: Decimal;
    try {
      fxRate = await resolveFxRateForFill({
        groupCurrency: group.defaultCurrency,
        expenseCurrency: draft.currency,
        occurredAt: draft.occurredAt,
      });
    } catch (e) {
      failed.push({ expenseId: item.expenseId, error: extractCode(e) });
      continue;
    }

    const rule = { type: 'EQUAL' as const, memberIds };
    let splits: Map<string, bigint>;
    try {
      splits = computeSplit({
        totalMinor: amountMinor,
        rule,
        payerMemberId: draft.payerMemberId,
        validMemberIds: validIds,
      });
    } catch (e) {
      failed.push({ expenseId: item.expenseId, error: extractCode(e) });
      continue;
    }

    try {
      await prisma.$transaction(async (tx) => {
        await tx.expenseSplit.deleteMany({ where: { expenseId: draft.id } });
        await tx.expense.update({
          where: { id: draft.id },
          data: {
            amountMinor,
            fxRateToGroupCurrency: new Prisma.Decimal(fxRate.toString()),
            splitRule: rule as unknown as Prisma.InputJsonValue,
            isDraft: false,
            splits: {
              create: Array.from(splits, ([memberId, shareMinor]) => ({
                memberId,
                shareMinor,
              })),
            },
          },
        });
        await tx.auditLog.create({
          data: {
            groupId: parsed.data.groupId,
            actorType: actor.auditActor.type,
            actorId: actor.auditActor.id,
            action: 'EXPENSE_FILL_DRAFT',
            targetType: 'Expense',
            targetId: draft.id,
          },
        });
      });
      filled.push(draft.id);
    } catch {
      failed.push({ expenseId: item.expenseId, error: 'errors.unknown' });
    }
  }

  if (filled.length === 0) {
    return { ok: false, error: failed[0]?.error ?? 'errors.unknown', failed };
  }

  revalidatePath(`/groups/${parsed.data.groupId}`);
  for (const id of filled) {
    await publish({
      type: 'EXPENSE_UPDATED',
      groupId: parsed.data.groupId,
      expenseId: id,
    }).catch(() => {});
  }
  return { ok: true, filled, failed: failed.length > 0 ? failed : undefined };
}
