/**
 * Auto-claim helper invoked from login/register flows.
 *
 * If the user has an active share-session cookie pointing at a member-bound
 * share link AND the bound member is unclaimed (or already claimed by THIS
 * user), bind member.linkedUserId to userId and ensure a GroupMembership
 * row with role=MEMBER. The share-session cookie is destroyed at the end
 * (the user no longer needs it; their authenticated session takes over).
 *
 * Returns the groupId we bound to, or null if there was nothing to claim.
 *
 * Safe to call after every successful login / register / passkey auth.
 * Never throws — failures degrade to "no claim".
 */

import { cookies } from 'next/headers';
import { prisma } from '@/lib/db';
import { hashSessionToken } from './tokens';
import { SHARE_SESSION_COOKIE } from './share-session';
import { ROLE_RANK, type AssignableRole } from './roles';
import type { GroupRole, Prisma } from '@prisma/client';

export type LinkUserToMemberResult =
  | { ok: true; groupId: string }
  | {
      ok: false;
      code:
        | 'MEMBER_NOT_FOUND'
        | 'MEMBER_ALREADY_LINKED'
        | 'USER_ALREADY_LINKED_IN_GROUP'
        | 'NAME_CONFLICT';
    };

/**
 * Shared "bind a user account to a Member slot" core, used by both the
 * share-link auto-claim path and the invitation-accept path.
 *
 * Invariants:
 *   - Refuses if the Member is already linked to a different user.
 *   - Refuses if THIS user is already linked to a different Member of the
 *     same group (one account → one member per group).
 *   - Refuses if the user's displayName would collide with another Member
 *     in the same group.
 *   - On success: sets `member.linkedUserId = userId`, syncs displayName,
 *     hard-kills any other active ShareLinks for this Member, and upserts
 *     the user's GroupMembership at `max(current role, grantedRole)` — we
 *     never silently demote.
 *
 * Idempotent for the same `(userId, memberId)` — re-running just bumps the
 * role if the new grant is higher.
 */
export async function linkUserToMember(input: {
  userId: string;
  memberId: string;
  grantedRole: AssignableRole;
  /** Optional Prisma transaction client. When omitted we open our own. */
  tx?: Prisma.TransactionClient;
}): Promise<LinkUserToMemberResult> {
  const runner = input.tx ?? prisma;

  const member = await runner.member.findUnique({
    where: { id: input.memberId },
    select: { id: true, linkedUserId: true, groupId: true },
  });
  if (!member) return { ok: false, code: 'MEMBER_NOT_FOUND' };

  if (member.linkedUserId !== null && member.linkedUserId !== input.userId) {
    return { ok: false, code: 'MEMBER_ALREADY_LINKED' };
  }

  if (member.linkedUserId !== input.userId) {
    const conflicting = await runner.member.findFirst({
      where: { groupId: member.groupId, linkedUserId: input.userId },
      select: { id: true },
    });
    if (conflicting && conflicting.id !== member.id) {
      return { ok: false, code: 'USER_ALREADY_LINKED_IN_GROUP' };
    }
  }

  const account = await runner.user.findUnique({
    where: { id: input.userId },
    select: { displayName: true },
  });
  const nextMemberName = account?.displayName?.slice(0, 40) ?? null;

  if (member.linkedUserId !== input.userId) {
    if (nextMemberName) {
      const conflict = await runner.member.findFirst({
        where: {
          groupId: member.groupId,
          id: { not: member.id },
          displayName: { equals: nextMemberName, mode: 'insensitive' },
        },
        select: { id: true },
      });
      if (conflict) return { ok: false, code: 'NAME_CONFLICT' };
    }

    await runner.member.update({
      where: { id: member.id },
      data: {
        linkedUserId: input.userId,
        ...(nextMemberName ? { displayName: nextMemberName } : {}),
      },
    });
    // Hard-kill all OTHER active links for this member; the binding is done.
    await runner.shareLink.updateMany({
      where: {
        memberId: member.id,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
    await runner.shareSession.deleteMany({
      where: { shareLink: { memberId: member.id } },
    });
  }

  const current = await runner.groupMembership.findUnique({
    where: { userId_groupId: { userId: input.userId, groupId: member.groupId } },
    select: { role: true },
  });
  if (!current) {
    await runner.groupMembership.create({
      data: { userId: input.userId, groupId: member.groupId, role: input.grantedRole },
    });
  } else if (ROLE_RANK[input.grantedRole] > ROLE_RANK[current.role as GroupRole]) {
    await runner.groupMembership.update({
      where: { userId_groupId: { userId: input.userId, groupId: member.groupId } },
      data: { role: input.grantedRole },
    });
  }

  return { ok: true, groupId: member.groupId };
}

export async function claimPendingShareLink(userId: string): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SHARE_SESSION_COOKIE)?.value;
  if (!token) return null;
  const tokenHash = hashSessionToken(token);

  const sess = await prisma.shareSession.findUnique({
    where: { tokenHash },
    include: { shareLink: true },
  });
  if (!sess) return null;

  const link = sess.shareLink;
  if (link.revokedAt) return null;
  if (link.expiresAt && link.expiresAt <= new Date()) return null;
  if (!link.memberId) return null;

  const grantedRole: AssignableRole =
    (link.assignedRole as AssignableRole | null) ?? 'MEMBER';

  const result = await prisma.$transaction(async (tx) =>
    linkUserToMember({ userId, memberId: link.memberId!, grantedRole, tx }),
  );

  // The share-session cookie is no longer needed; the regular auth session
  // takes over. Best-effort cleanup (if the row is gone we don't care).
  await prisma.shareSession.delete({ where: { tokenHash } }).catch(() => {});
  cookieStore.delete(SHARE_SESSION_COOKIE);

  return result.ok ? result.groupId : null;
}
