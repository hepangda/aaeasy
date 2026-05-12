'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { publish } from '@/lib/realtime/pgNotify';
import {
  destroyCurrentSession,
  getCurrentSession,
  requireUser,
} from '@/lib/auth/session';

export type AccountActionState = { ok: boolean; error?: string; fieldErrors?: Record<string, string> };

/**
 * List the IDs of every group where the current user holds the OWNER
 * role. These are the groups that would be **deleted** if the account
 * were removed without transferring ownership first.
 */
export async function listOwnedGroups(): Promise<
  { id: string; name: string; memberCount: number }[]
> {
  const ctx = await getCurrentSession();
  if (!ctx) return [];
  const memberships = await prisma.groupMembership.findMany({
    where: { userId: ctx.user.id, role: 'OWNER' },
    select: {
      group: {
        select: {
          id: true,
          name: true,
          _count: { select: { members: true } },
        },
      },
    },
    orderBy: { joinedAt: 'asc' },
  });
  return memberships.map((m) => ({
    id: m.group.id,
    name: m.group.name,
    memberCount: m.group._count.members,
  }));
}

/**
 * Delete the current user's account.
 *
 * Steps:
 *   1. Hard-delete every group where the user is OWNER. The group cascade
 *      handles members, expenses, settlements, etc.
 *   2. Delete the user row. `Member.linkedUserId` switches to NULL via
 *      `onDelete: SetNull` so groups owned by *other* people keep the
 *      member rows + history intact, just unlinked from this account.
 *   3. Destroy the current session and redirect home.
 *
 * The action is destructive and irreversible — the UI must surface an
 * explicit confirmation listing every owned group beforehand.
 */
export async function deleteAccountAction(): Promise<never> {
  const ctx = await requireUser();
  const userId = ctx.user.id;

  // Find owned groups.
  const owned = await prisma.groupMembership.findMany({
    where: { userId, role: 'OWNER' },
    select: { groupId: true },
  });

  // Cascade-delete each owned group. We loop instead of `deleteMany` so
  // Prisma fires the relational cascades correctly via the FK rules
  // declared on Member/Expense/etc.
  for (const m of owned) {
    await prisma.group.delete({ where: { id: m.groupId } }).catch(() => {
      // Group may already be gone (race); ignore.
    });
  }

  await prisma.user.delete({ where: { id: userId } });
  await destroyCurrentSession();
  revalidatePath('/');
  redirect('/');
}

/**
 * Transfer the OWNER role of a group to another linked user.
 *
 * Constraints:
 *   - Caller must currently be the OWNER.
 *   - Target must already be a GroupMembership of this group.
 *   - Target must be linked to a Member of this group (so the new OWNER
 *     can act as themselves; this matches the invariant that an OWNER
 *     always has a linked member).
 *
 * After the transfer the previous OWNER is demoted to MANAGER (they keep
 * full edit rights but lose delete-group + cannot be unbound).
 */
export async function transferOwnershipAction(input: {
  groupId: string;
  newOwnerUserId: string;
}): Promise<AccountActionState> {
  const ctx = await requireUser();

  if (input.newOwnerUserId === ctx.user.id) {
    return { ok: false, error: 'errors.invalid_input' };
  }

  const me = await prisma.groupMembership.findUnique({
    where: {
      userId_groupId: { userId: ctx.user.id, groupId: input.groupId },
    },
    select: { role: true },
  });
  if (me?.role !== 'OWNER') return { ok: false, error: 'errors.forbidden' };

  const target = await prisma.groupMembership.findUnique({
    where: {
      userId_groupId: { userId: input.newOwnerUserId, groupId: input.groupId },
    },
    select: { role: true },
  });
  if (!target) return { ok: false, error: 'errors.not_found' };

  // Target must own a Member binding — otherwise the new OWNER would
  // have no member identity to act as.
  const targetMember = await prisma.member.findFirst({
    where: { groupId: input.groupId, linkedUserId: input.newOwnerUserId },
    select: { id: true },
  });
  if (!targetMember) return { ok: false, error: 'errors.target_not_linked' };

  await prisma.$transaction([
    prisma.groupMembership.update({
      where: {
        userId_groupId: { userId: input.newOwnerUserId, groupId: input.groupId },
      },
      data: { role: 'OWNER' },
    }),
    prisma.groupMembership.update({
      where: {
        userId_groupId: { userId: ctx.user.id, groupId: input.groupId },
      },
      data: { role: 'MANAGER' },
    }),
  ]);

  revalidatePath(`/groups/${input.groupId}`);
  return { ok: true };
}

/**
 * Set or update the current user's display name.
 */
export async function setDisplayNameAction(
  _prev: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
  const ctx = await getCurrentSession();
  if (!ctx) return { ok: false, error: 'errors.unauthenticated' };

  const displayName = (formData.get('displayName') as string)?.trim() ?? '';
  
  if (!displayName || displayName.length > 64) {
    return {
      ok: false,
      fieldErrors: { displayName: 'errors.display_name_required' },
    };
  }

  const userId = ctx.user.id;

  // Global uniqueness: two accounts cannot share the same display name.
  const nameTakenByOtherUser = await prisma.user.findFirst({
    where: {
      id: { not: userId },
      displayName: { equals: displayName, mode: 'insensitive' },
    },
    select: { id: true },
  });
  if (nameTakenByOtherUser) {
    return {
      ok: false,
      fieldErrors: { displayName: 'errors.display_name_taken' },
    };
  }

  // Sync target: every member currently bound to this account.
  const linkedMembers = await prisma.member.findMany({
    where: { linkedUserId: userId },
    select: { id: true, groupId: true },
  });

  // Group-level uniqueness: in each affected group, no other member may
  // already have this name.
  for (const m of linkedMembers) {
    const conflict = await prisma.member.findFirst({
      where: {
        groupId: m.groupId,
        id: { not: m.id },
        displayName: { equals: displayName.slice(0, 40), mode: 'insensitive' },
      },
      select: { id: true },
    });
    if (conflict) {
      return {
        ok: false,
        fieldErrors: { displayName: 'errors.member_name_taken' },
      };
    }
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { displayName },
    }),
    prisma.member.updateMany({
      where: { linkedUserId: userId },
      data: { displayName: displayName.slice(0, 40) },
    }),
  ]);

  for (const gid of new Set(linkedMembers.map((m) => m.groupId))) {
    await publish({ type: 'MEMBER_CHANGED', groupId: gid }).catch(() => {});
  }
  
  revalidatePath('/groups');
  revalidatePath('/account');
  return { ok: true };
}
