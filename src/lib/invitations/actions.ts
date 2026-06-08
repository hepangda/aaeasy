'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireGroupAccess } from '@/lib/auth/group-access';
import { requireUser } from '@/lib/auth/session';
import { linkUserToMember } from '@/lib/auth/claim-share';
import type { AssignableRole } from '@/lib/auth/roles';
import { publish } from '@/lib/realtime/pgNotify';

// Account-binding flow excludes OWNER (ownership transfer has its own flow).
// VIEWER is allowed: a manager may want to bind a read-only auditor account
// without having to fall back to an anonymous share link.
const invitationRoleSchema = z.enum(['MANAGER', 'MEMBER', 'VIEWER']);
export type InvitationRole = z.infer<typeof invitationRoleSchema>;

const inviteSchema = z.object({
  groupId: z.string().min(1),
  memberId: z.string().min(1),
  // Mirror auth/actions.ts username rules. The UI lets the user type freely
  // and surfaces "no user found" via the action's lookup step rather than
  // pre-validating length, so the only failure modes here are "garbage that
  // could never be a username" (regex) or "ridiculously long".
  username: z
    .string()
    .trim()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9_.-]+$/),
  assignedRole: invitationRoleSchema,
  message: z.string().trim().max(200).optional().or(z.literal('')),
});

export type InvitationActionState = { ok: boolean; error?: string };
export type BulkInvitationResult = {
  ok: boolean;
  accepted?: string[];
  rejected?: string[];
  failed?: { id: string; error: string }[];
  error?: string;
};

/**
 * Send an account-binding invitation: target `User.username` is invited to
 * fill the unlinked Member slot at `memberId`, at role `MEMBER` or `MANAGER`.
 *
 * Permission: MANAGE_SHARES (OWNER + MANAGER). Mirrors share-actions.ts —
 * MANAGER cannot grant MANAGER (only OWNER may).
 */
export async function inviteUserToMemberAction(input: {
  groupId: string;
  memberId: string;
  username: string;
  assignedRole: InvitationRole;
  message?: string;
}): Promise<InvitationActionState> {
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'errors.invalid_input' };

  const { groupId, memberId, username, assignedRole, message } = parsed.data;

  const access = await requireGroupAccess(groupId, 'MANAGE_SHARES');
  if (access.kind !== 'user') return { ok: false, error: 'errors.forbidden' };

  if (assignedRole === 'MANAGER' && access.role !== 'OWNER') {
    return { ok: false, error: 'errors.forbidden' };
  }

  const lookupUsername = username.toLowerCase();
  const targetUser = await prisma.user.findUnique({
    where: { username: lookupUsername },
    select: { id: true },
  });
  if (!targetUser) return { ok: false, error: 'errors.user_not_found' };

  if (targetUser.id === access.userId) {
    return { ok: false, error: 'errors.cannot_invite_self' };
  }

  const member = await prisma.member.findUnique({
    where: { id: memberId },
    select: { groupId: true, linkedUserId: true },
  });
  if (!member || member.groupId !== groupId) {
    return { ok: false, error: 'errors.not_found' };
  }
  if (member.linkedUserId) {
    return { ok: false, error: 'errors.member_already_linked' };
  }

  const otherBound = await prisma.member.findFirst({
    where: { groupId, linkedUserId: targetUser.id },
    select: { id: true },
  });
  if (otherBound) return { ok: false, error: 'errors.user_already_linked_in_group' };

  try {
    await prisma.groupInvitation.create({
      data: {
        groupId,
        memberId,
        invitedUserId: targetUser.id,
        invitedById: access.userId,
        assignedRole,
        message: message?.trim() ? message.trim() : null,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { ok: false, error: 'errors.invitation_exists' };
    }
    throw err;
  }

  revalidatePath(`/groups/${groupId}`);
  revalidatePath('/groups');
  await publish({ type: 'MEMBER_CHANGED', groupId }).catch(() => {});
  return { ok: true };
}

/**
 * Bulk-accept invitations addressed to the current user. Each invitation is
 * processed independently: failures are returned per-id instead of aborting
 * the whole batch.
 *
 * Successful accept:
 *   - Member.linkedUserId set to current user (via linkUserToMember)
 *   - GroupMembership upserted at max(current, assignedRole)
 *   - Other PENDING invitations for the SAME member are auto-CANCELED
 *   - This invitation marked ACCEPTED with respondedAt
 */
export async function acceptInvitationsAction(
  ids: string[],
): Promise<BulkInvitationResult> {
  if (!Array.isArray(ids) || ids.length === 0) {
    return { ok: false, error: 'errors.invalid_input' };
  }
  const ctx = await requireUser();
  const userId = ctx.user.id;

  const rows = await prisma.groupInvitation.findMany({
    where: { id: { in: ids }, invitedUserId: userId, status: 'PENDING' },
    select: {
      id: true,
      groupId: true,
      memberId: true,
      assignedRole: true,
    },
  });

  const accepted: string[] = [];
  const failed: { id: string; error: string }[] = [];
  const touchedGroups = new Set<string>();

  for (const inv of rows) {
    try {
      await prisma.$transaction(async (tx) => {
        const result = await linkUserToMember({
          userId,
          memberId: inv.memberId,
          grantedRole: inv.assignedRole as AssignableRole,
          tx,
        });
        if (!result.ok) {
          throw new InvitationFailure(linkErrorToI18n(result.code));
        }
        await tx.groupInvitation.update({
          where: { id: inv.id },
          data: { status: 'ACCEPTED', respondedAt: new Date() },
        });
        // Other pending invites for this same Member slot are now moot.
        await tx.groupInvitation.updateMany({
          where: {
            memberId: inv.memberId,
            status: 'PENDING',
            id: { not: inv.id },
          },
          data: { status: 'CANCELED', respondedAt: new Date() },
        });
      });
      accepted.push(inv.id);
      touchedGroups.add(inv.groupId);
    } catch (err) {
      if (err instanceof InvitationFailure) {
        failed.push({ id: inv.id, error: err.i18nKey });
      } else {
        failed.push({ id: inv.id, error: 'errors.unknown' });
      }
    }
  }

  // Report unknown IDs (already responded, deleted, or not yours) so the
  // UI can scrub them from the selection.
  const seenIds = new Set(rows.map((r) => r.id));
  for (const id of ids) {
    if (!seenIds.has(id) && !accepted.includes(id) && !failed.some((f) => f.id === id)) {
      failed.push({ id, error: 'errors.invitation_not_pending' });
    }
  }

  revalidatePath('/groups');
  for (const gid of touchedGroups) {
    revalidatePath(`/groups/${gid}`);
    await publish({ type: 'MEMBER_CHANGED', groupId: gid }).catch(() => {});
  }
  return { ok: true, accepted, failed };
}

export async function rejectInvitationsAction(
  ids: string[],
): Promise<BulkInvitationResult> {
  if (!Array.isArray(ids) || ids.length === 0) {
    return { ok: false, error: 'errors.invalid_input' };
  }
  const ctx = await requireUser();
  const userId = ctx.user.id;

  const updated = await prisma.groupInvitation.updateMany({
    where: { id: { in: ids }, invitedUserId: userId, status: 'PENDING' },
    data: { status: 'REJECTED', respondedAt: new Date() },
  });
  revalidatePath('/groups');
  return { ok: true, rejected: ids, accepted: [], failed: updated.count === ids.length ? [] : undefined };
}

export async function rejectAllInvitationsAction(): Promise<BulkInvitationResult> {
  const ctx = await requireUser();
  const userId = ctx.user.id;
  const updated = await prisma.groupInvitation.updateMany({
    where: { invitedUserId: userId, status: 'PENDING' },
    data: { status: 'REJECTED', respondedAt: new Date() },
  });
  revalidatePath('/groups');
  return { ok: true, rejected: [], accepted: [], failed: [], error: undefined };
  // count surfaced via revalidate / next render
  void updated;
}

/**
 * Inviter cancels an outstanding invitation they sent. Allowed for any
 * MANAGER/OWNER of the group (not strictly the original sender) because
 * the invitation is a property of the Member slot, not personal mail.
 */
export async function cancelInvitationAction(input: {
  groupId: string;
  invitationId: string;
}): Promise<InvitationActionState> {
  await requireGroupAccess(input.groupId, 'MANAGE_SHARES');
  const updated = await prisma.groupInvitation.updateMany({
    where: {
      id: input.invitationId,
      groupId: input.groupId,
      status: 'PENDING',
    },
    data: { status: 'CANCELED', respondedAt: new Date() },
  });
  if (updated.count === 0) {
    return { ok: false, error: 'errors.invitation_not_pending' };
  }
  revalidatePath(`/groups/${input.groupId}`);
  return { ok: true };
}

class InvitationFailure extends Error {
  constructor(public i18nKey: string) {
    super(i18nKey);
    this.name = 'InvitationFailure';
  }
}

function linkErrorToI18n(
  code:
    | 'MEMBER_NOT_FOUND'
    | 'MEMBER_ALREADY_LINKED'
    | 'USER_ALREADY_LINKED_IN_GROUP'
    | 'NAME_CONFLICT',
): string {
  switch (code) {
    case 'MEMBER_NOT_FOUND':
      return 'errors.not_found';
    case 'MEMBER_ALREADY_LINKED':
      return 'errors.member_already_linked';
    case 'USER_ALREADY_LINKED_IN_GROUP':
      return 'errors.user_already_linked_in_group';
    case 'NAME_CONFLICT':
      return 'errors.member_name_taken';
  }
}
