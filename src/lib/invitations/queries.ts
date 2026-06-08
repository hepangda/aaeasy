import { prisma } from '@/lib/db';

/**
 * Pending invitations addressed to `userId`. Pulled by the /groups page and
 * fed to `<PendingInvitationsPanel>`. Excludes anything but PENDING — the
 * panel never surfaces accepted/rejected/canceled rows.
 *
 * The query also filters to:
 *   - groups that aren't soft-deleted (`group.deletedAt: null`)
 *   - members that still exist (cascade keeps this consistent, but the
 *     filter is cheap defense-in-depth)
 *
 * Ordered newest-first so freshly-sent invites appear at the top.
 */
export async function getPendingInvitationsForUser(userId: string) {
  return prisma.groupInvitation.findMany({
    where: {
      invitedUserId: userId,
      status: 'PENDING',
      group: { deletedAt: null },
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      groupId: true,
      memberId: true,
      assignedRole: true,
      message: true,
      createdAt: true,
      group: { select: { id: true, name: true } },
      member: { select: { id: true, displayName: true } },
      invitedBy: { select: { id: true, displayName: true, username: true } },
    },
  });
}

export type PendingInvitationRow = Awaited<
  ReturnType<typeof getPendingInvitationsForUser>
>[number];

/**
 * Pending invitations for a specific Member slot — shown inside the
 * AccountBindingDialog so the inviter can see and cancel outstanding asks.
 */
export async function getPendingInvitationsForMember(
  groupId: string,
  memberId: string,
) {
  return prisma.groupInvitation.findMany({
    where: { groupId, memberId, status: 'PENDING' },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      memberId: true,
      assignedRole: true,
      createdAt: true,
      invitedUser: { select: { id: true, displayName: true, username: true } },
      invitedBy: { select: { id: true, displayName: true } },
    },
  });
}

export type MemberPendingInvitationRow = Awaited<
  ReturnType<typeof getPendingInvitationsForMember>
>[number];
