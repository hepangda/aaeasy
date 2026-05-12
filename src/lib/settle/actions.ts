'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireGroupAccess, AccessError } from '@/lib/auth/group-access';
import { requireUser } from '@/lib/auth/session';
import { computeSummary } from '@/lib/expenses/queries';
import { settle } from '@/lib/settle';
import { publish } from '@/lib/realtime/pgNotify';
import Decimal from 'decimal.js';

export type SettleActionState = {
  ok: boolean;
  error?: string;
  settlementId?: string;
};

const inputSchema = z.object({
  groupId: z.string().min(1),
});

/**
 * Snapshot shape persisted in `Settlement.snapshotJson`. Versioned so future
 * algorithm changes don't break the read path on historical rows.
 *
 * v1 had `periodStart`/`periodEnd` from when groups had a long-lived mode;
 * v2 dropped them. Old v1 records stay readable — unused JSON fields are
 * just ignored by readers.
 */
export interface SettlementSnapshot {
  version: 2;
  groupId: string;
  groupName: string;
  defaultCurrency: string;
  createdAt: string;
  members: { id: string; displayName: string }[];
  expenses: {
    id: string;
    occurredAt: string;
    title: string;
    currency: string;
    amountMinor: string; // BigInt → decimal string
    fxRateToGroupCurrency: string;
    payerMemberId: string;
    splits: { memberId: string; shareMinor: string }[];
  }[];
  summary: {
    memberId: string;
    paidMinorInGroup: string;
    owedMinorInGroup: string;
    netMinorInGroup: string;
  }[];
  transfers: { from: string; to: string; amountMinor: string }[];
}

function bigToStr(n: bigint): string {
  return n.toString();
}

export async function settleAction(input: unknown): Promise<SettleActionState> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'errors.invalid_input' };
  const { groupId } = parsed.data;

  // Permission: SETTLE = OWNER only.
  try {
    await requireGroupAccess(groupId, 'SETTLE');
  } catch (e) {
    if (e instanceof AccessError) return { ok: false, error: 'errors.forbidden' };
    throw e;
  }

  const userCtx = await requireUser();

  // Pull everything we need for the snapshot in a single read.
  const group = await prisma.group.findUniqueOrThrow({
    where: { id: groupId },
    include: {
      members: { orderBy: { sortOrder: 'asc' } },
      expenses: {
        where: {
          deletedAt: null,
          lockedBySettlementId: null,
          isDraft: false,
        },
        orderBy: { occurredAt: 'asc' },
        include: { splits: true },
      },
    },
  });

  if (group.expenses.length === 0) {
    return { ok: false, error: 'errors.nothing_to_settle' };
  }

  // Compute summary + transfers using the pure helpers. We map to the same
  // shape `loadGroupLedger` produces so we can reuse `computeSummary`.
  const expenseLites = group.expenses.map((e) => ({
    id: e.id,
    occurredAt: e.occurredAt,
    title: e.title,
    note: e.note,
    currency: e.currency,
    amountMinor: e.amountMinor!,
    fxRateToGroupCurrency: new Decimal(e.fxRateToGroupCurrency!.toString()),
    payerMemberId: e.payerMemberId,
    tags: e.tags,
    splits: e.splits.map((s) => ({ memberId: s.memberId, shareMinor: s.shareMinor })),
    receipts: [],
    splitRule: e.splitRule,
    lockedBySettlementId: e.lockedBySettlementId,
    isDraft: false,
  }));

  const summary = computeSummary(
    group.defaultCurrency,
    group.members.map((m) => ({
      id: m.id,
      displayName: m.displayName,
      sortOrder: m.sortOrder,
      linkedUserId: m.linkedUserId,
      linkedUsername: null,
      linkedUserDisplayName: null,
      linkedUserRole: null,
      color: m.color,
    })),
    expenseLites,
  );
  const transfers = settle(
    summary.map((s) => ({ memberId: s.memberId, netMinor: s.netMinorInGroup })),
  );

  // Build the snapshot. BigInts → strings (JSON can't represent BigInt).
  const snapshot: SettlementSnapshot = {
    version: 2,
    groupId: group.id,
    groupName: group.name,
    defaultCurrency: group.defaultCurrency,
    createdAt: new Date().toISOString(),
    members: group.members.map((m) => ({ id: m.id, displayName: m.displayName })),
    expenses: group.expenses.map((e) => ({
      id: e.id,
      occurredAt: e.occurredAt.toISOString(),
      title: e.title,
      currency: e.currency,
      amountMinor: bigToStr(e.amountMinor!),
      fxRateToGroupCurrency: e.fxRateToGroupCurrency!.toString(),
      payerMemberId: e.payerMemberId,
      splits: e.splits.map((s) => ({
        memberId: s.memberId,
        shareMinor: bigToStr(s.shareMinor),
      })),
    })),
    summary: summary.map((s) => ({
      memberId: s.memberId,
      paidMinorInGroup: bigToStr(s.paidMinorInGroup),
      owedMinorInGroup: bigToStr(s.owedMinorInGroup),
      netMinorInGroup: bigToStr(s.netMinorInGroup),
    })),
    transfers: transfers.map((t) => ({
      from: t.from,
      to: t.to,
      amountMinor: bigToStr(t.amountMinor),
    })),
  };

  const lockedExpenseIds = group.expenses.map((e) => e.id);
  const deleteDraftsAt = new Date();

  const settlement = await prisma.$transaction(async (tx) => {
    const created = await tx.settlement.create({
      data: {
        groupId,
        snapshotJson: snapshot as unknown as Prisma.InputJsonValue,
        createdById: userCtx.user.id,
      },
      select: { id: true },
    });

    await tx.expense.updateMany({
      where: { id: { in: lockedExpenseIds } },
      data: { lockedBySettlementId: created.id },
    });

    await tx.expense.updateMany({
      where: {
        groupId,
        deletedAt: null,
        lockedBySettlementId: null,
        isDraft: true,
      },
      data: { deletedAt: deleteDraftsAt },
    });

    // Settling always archives the group; reopen via reopenSettlementAction.
    if (group.status === 'ACTIVE') {
      await tx.group.update({
        where: { id: groupId },
        data: { status: 'ARCHIVED' },
      });
    }

    await tx.auditLog.create({
      data: {
        groupId,
        actorType: 'USER',
        actorId: userCtx.user.id,
        action: 'SETTLEMENT_CREATE',
        targetType: 'Settlement',
        targetId: created.id,
      },
    });

    return created;
  });

  revalidatePath(`/groups/${groupId}`);
  await publish({ type: 'GROUP_UPDATED', groupId }).catch(() => {});

  return { ok: true, settlementId: settlement.id };
}
