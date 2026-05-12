'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireGroupAccess, AccessError } from '@/lib/auth/group-access';
import { requireUser } from '@/lib/auth/session';
import { publish } from '@/lib/realtime/pgNotify';

export type ReopenState = { ok: boolean; error?: string };

const inputSchema = z.object({
  settlementId: z.string().min(1),
});

/**
 * Reopen a settlement: unlock its expenses, delete the settlement (cascading
 * to TransferPayments), and re-activate the group. OWNER-only.
 *
 * Audit-logged with action=`SETTLEMENT_REOPEN` so the history of opening and
 * closing the books survives even when the settlement row is gone.
 *
 * On success this redirects to the group home page so the caller doesn't end
 * up looking at a 404 settlement.
 */
export async function reopenSettlementAction(input: unknown): Promise<ReopenState> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'errors.invalid_input' };
  const { settlementId } = parsed.data;

  const s = await prisma.settlement.findUnique({
    where: { id: settlementId },
    select: { groupId: true },
  });
  if (!s) return { ok: false, error: 'errors.not_found' };

  try {
    await requireGroupAccess(s.groupId, 'SETTLE');
  } catch (e) {
    if (e instanceof AccessError) return { ok: false, error: 'errors.forbidden' };
    throw e;
  }
  const userCtx = await requireUser();

  await prisma.$transaction(async (tx) => {
    await tx.expense.updateMany({
      where: { lockedBySettlementId: settlementId },
      data: { lockedBySettlementId: null },
    });
    await tx.settlement.delete({ where: { id: settlementId } });
    await tx.group.update({
      where: { id: s.groupId },
      data: { status: 'ACTIVE' },
    });
    await tx.auditLog.create({
      data: {
        groupId: s.groupId,
        actorType: 'USER',
        actorId: userCtx.user.id,
        action: 'SETTLEMENT_REOPEN',
        targetType: 'Settlement',
        targetId: settlementId,
      },
    });
  });

  revalidatePath(`/groups/${s.groupId}`);
  await publish({ type: 'GROUP_UPDATED', groupId: s.groupId }).catch(() => {});

  redirect(`/groups/${s.groupId}`);
}
