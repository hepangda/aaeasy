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
import type { GroupRole } from '@prisma/client';

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
  // Hard-killed links cannot be claimed.
  if (link.revokedAt) return null;
  // Expired links: still usable as read-only, but binding stops here.
  if (link.expiresAt && link.expiresAt <= new Date()) return null;
  // Unbound link: nothing to claim.
  if (!link.memberId) return null;

  const member = await prisma.member.findUnique({
    where: { id: link.memberId },
    select: { id: true, linkedUserId: true, groupId: true },
  });
  if (!member) return null;

  // Already linked to a different user — leave alone.
  if (member.linkedUserId !== null && member.linkedUserId !== userId) return null;

  // One account may bind to at most ONE member per group. If this user
  // is already linked to a *different* member of the same group, abort
  // the auto-claim silently (the explicit unlock flow surfaces an error).
  if (member.linkedUserId !== userId) {
    const conflicting = await prisma.member.findFirst({
      where: { groupId: member.groupId, linkedUserId: userId },
      select: { id: true },
    });
    if (conflicting && conflicting.id !== member.id) return null;
  }

  // Pick up the user's current display name so the member row reflects
  // the real account on first claim.
  const account = await prisma.user.findUnique({
    where: { id: userId },
    select: { displayName: true },
  });

  const grantedRole: AssignableRole =
    (link.assignedRole as AssignableRole | null) ?? 'MEMBER';
  const nextMemberName = account?.displayName?.slice(0, 40) ?? null;

  if (member.linkedUserId !== userId) {
    if (nextMemberName) {
      const conflict = await prisma.member.findFirst({
        where: {
          groupId: member.groupId,
          id: { not: member.id },
          displayName: { equals: nextMemberName, mode: 'insensitive' },
        },
        select: { id: true },
      });
      if (conflict) return null;
    }

    await prisma.$transaction([
      prisma.member.update({
        where: { id: member.id },
        data: {
          linkedUserId: userId,
          ...(nextMemberName ? { displayName: nextMemberName } : {}),
        },
      }),
      // Hard-kill all OTHER active links for this member; this one has
      // done its job.
      prisma.shareLink.updateMany({
        where: {
          memberId: member.id,
          revokedAt: null,
          NOT: { id: link.id },
        },
        data: { revokedAt: new Date() },
      }),
      prisma.shareSession.deleteMany({
        where: {
          shareLink: { memberId: member.id, NOT: { id: link.id } },
        },
      }),
    ]);
  }

  // Apply the link's assigned role, but never demote an existing higher
  // role (e.g. MANAGER reclaiming a MEMBER-grade link stays MANAGER).
  const current = await prisma.groupMembership.findUnique({
    where: { userId_groupId: { userId, groupId: member.groupId } },
    select: { role: true },
  });
  if (!current) {
    await prisma.groupMembership.create({
      data: { userId, groupId: member.groupId, role: grantedRole },
    });
  } else if (ROLE_RANK[grantedRole] > ROLE_RANK[current.role as GroupRole]) {
    await prisma.groupMembership.update({
      where: { userId_groupId: { userId, groupId: member.groupId } },
      data: { role: grantedRole },
    });
  }

  // The share-session cookie is no longer needed; the regular auth session
  // takes over. Best-effort cleanup (if the row is gone we don't care).
  await prisma.shareSession.delete({ where: { tokenHash } }).catch(() => {});
  cookieStore.delete(SHARE_SESSION_COOKIE);

  return member.groupId;
}
