'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireGroupAccess, AccessError } from '@/lib/auth/group-access';
import { getCurrentSession } from '@/lib/auth/session';
import { parseAmountToMinor } from '@/lib/money';
import { publish } from '@/lib/realtime/pgNotify';

export type SettlementEntryActionState = { ok: boolean; error?: string };

const addSchema = z.object({
  groupId: z.string().min(1),
  fromMemberId: z.string().min(1),
  toMemberId: z.string().min(1),
  /** Free-form text in MAJOR units of the group's default currency. */
  amount: z.string().min(1),
  note: z.string().max(200).optional().or(z.literal('')),
});

/**
 * Record a real money transfer between two members. Always denominated in
 * the group's default currency.
 *
 * Permission: WRITE_EXPENSE — anyone who can edit the books can log
 * settlement movements (typically either party of the transfer).
 */
export async function addSettlementEntryAction(
  input: unknown,
): Promise<SettlementEntryActionState> {
  const parsed = addSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'errors.invalid_input' };
  const { groupId, fromMemberId, toMemberId, amount, note } = parsed.data;

  if (fromMemberId === toMemberId) {
    return { ok: false, error: 'errors.same_member' };
  }

  let access;
  try {
    access = await requireGroupAccess(groupId, 'WRITE_EXPENSE');
  } catch (e) {
    if (e instanceof AccessError) return { ok: false, error: 'errors.forbidden' };
    throw e;
  }

  // Bound writers (share boundMemberId, or MEMBER role linkedMemberId):
  // the entry must involve them on at least one side.
  const boundTo =
    access.kind === 'share'
      ? access.boundMemberId
      : access.role === 'MEMBER'
        ? access.linkedMemberId
        : null;
  if (
    boundTo !== null &&
    fromMemberId !== boundTo &&
    toMemberId !== boundTo
  ) {
    return { ok: false, error: 'errors.forbidden' };
  }

  const group = await prisma.group.findUniqueOrThrow({
    where: { id: groupId },
    select: { defaultCurrency: true, members: { select: { id: true } } },
  });
  const validIds = new Set(group.members.map((m) => m.id));
  if (!validIds.has(fromMemberId) || !validIds.has(toMemberId)) {
    return { ok: false, error: 'errors.unknown_payer' };
  }

  let amountMinor: bigint;
  try {
    amountMinor = parseAmountToMinor(amount, group.defaultCurrency);
  } catch {
    return { ok: false, error: 'errors.invalid_amount' };
  }
  if (amountMinor <= 0n) return { ok: false, error: 'errors.amount_negative' };

  const ctx = await getCurrentSession();

  await prisma.settlementEntry.create({
    data: {
      groupId,
      fromMemberId,
      toMemberId,
      amountMinor,
      note: note?.trim() || null,
      createdById: ctx?.user.id ?? null,
    },
  });

  revalidatePath(`/groups/${groupId}`);
  await publish({ type: 'GROUP_UPDATED', groupId }).catch(() => {});

  return { ok: true };
}

const deleteSchema = z.object({ entryId: z.string().min(1) });

export async function deleteSettlementEntryAction(
  input: unknown,
): Promise<SettlementEntryActionState> {
  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'errors.invalid_input' };
  const { entryId } = parsed.data;

  const row = await prisma.settlementEntry.findUnique({
    where: { id: entryId },
    select: { groupId: true, fromMemberId: true, toMemberId: true },
  });
  if (!row) return { ok: false, error: 'errors.not_found' };

  let access;
  try {
    access = await requireGroupAccess(row.groupId, 'WRITE_EXPENSE');
  } catch (e) {
    if (e instanceof AccessError) return { ok: false, error: 'errors.forbidden' };
    throw e;
  }

  const boundTo =
    access.kind === 'share'
      ? access.boundMemberId
      : access.role === 'MEMBER'
        ? access.linkedMemberId
        : null;
  if (
    boundTo !== null &&
    row.fromMemberId !== boundTo &&
    row.toMemberId !== boundTo
  ) {
    return { ok: false, error: 'errors.forbidden' };
  }

  await prisma.settlementEntry.delete({ where: { id: entryId } });
  revalidatePath(`/groups/${row.groupId}`);
  await publish({ type: 'GROUP_UPDATED', groupId: row.groupId }).catch(() => {});

  return { ok: true };
}
