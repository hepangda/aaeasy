'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { hashSessionToken } from '@/lib/auth/tokens';
import { createShareSession } from '@/lib/auth/share-session';
import { getCurrentSession } from '@/lib/auth/session';
import { consume } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { ROLE_RANK, type AssignableRole } from '@/lib/auth/roles';
import type { GroupRole } from '@prisma/client';

export type UnlockState = {
  ok: boolean;
  error?: string;
  /** When the link is member-bound and the visitor is logged in but hasn't
   *  yet claimed the member, the action stops short of redirecting and
   *  asks the page to render a confirmation panel. */
  needsClaim?: { memberId: string; memberName: string };
};

const unlockSchema = z.object({
  token: z.string().min(10).max(128),
  /** Set after the user explicitly confirms "Yes, I am X" via the claim
   *  panel rendered on the same page. */
  claimMemberId: z.string().optional().or(z.literal('')),
});

/**
 * Validates the share token and, on success:
 *   - Revoked link → hard reject.
 *   - Expired-but-not-revoked → still creates a share session (the session
 *     itself will be served as read-only by `getCurrentShareSession`).
 *   - For unbound links: just issues the share session and redirects.
 *   - For bound links + signed-in visitor whose user is already linked to
 *     this member: ensures GroupMembership and redirects.
 *   - For bound links + signed-in visitor + unclaimed member: returns
 *     `needsClaim` so the page can prompt for confirmation. After the user
 *     clicks "Yes, I am X", the action is replayed with `claimMemberId` set
 *     and we link member.linkedUserId, create GroupMembership(MEMBER),
 *     redirect.
 *   - For bound links + signed-in visitor + member already linked to a
 *     different user: returns FORBIDDEN.
 */
export async function unlockShareAction(
  _prev: UnlockState,
  formData: FormData,
): Promise<UnlockState> {
  const ip = await getClientIp();
  // Per-IP attempts on share-link unlock: 30 / 10min.
  const rl = consume(`share:unlock:ip:${ip}`, { windowMs: 10 * 60_000, max: 30 });
  if (!rl.ok) return { ok: false, error: 'errors.rate_limited' };

  const parsed = unlockSchema.safeParse({
    token: formData.get('token'),
    claimMemberId: formData.get('claimMemberId') || undefined,
  });
  if (!parsed.success) return { ok: false, error: 'errors.invalid_link' };

  const { token, claimMemberId } = parsed.data;
  const link = await prisma.shareLink.findUnique({
    where: { tokenHash: hashSessionToken(token) },
  });

  if (!link || link.revokedAt) return { ok: false, error: 'errors.invalid_link' };

  // ─── Bound link + signed-in visitor ────────────────────────────────
  // For an expired bound link we don't run the claim flow — the link is
  // read-only at this point, so there's no point in newly binding the
  // user to that member. Fall through to the anonymous read-only path.
  const linkExpired =
    link.expiresAt !== null && link.expiresAt <= new Date();

  const userCtx = await getCurrentSession();
  if (link.memberId && userCtx && !linkExpired) {
    const member = await prisma.member.findUnique({
      where: { id: link.memberId },
      select: { id: true, displayName: true, linkedUserId: true, groupId: true },
    });
    if (!member) return { ok: false, error: 'errors.invalid_link' };

    if (member.linkedUserId === userCtx.user.id) {
      // Already claimed by this user — make sure they're a group member
      // (upgrading the role if this link grants more), then drop in.
      await applyAssignedRole(
        userCtx.user.id,
        link.groupId,
        (link.assignedRole as AssignableRole | null) ?? 'MEMBER',
      );
      redirect(`/groups/${link.groupId}`);
    }

    if (member.linkedUserId !== null && member.linkedUserId !== userCtx.user.id) {
      return { ok: false, error: 'errors.member_already_claimed' };
    }

    // One account may bind to at most ONE member per group. Reject if the
    // visitor is already linked to a different member here.
    const conflicting = await prisma.member.findFirst({
      where: { groupId: member.groupId, linkedUserId: userCtx.user.id },
      select: { id: true },
    });
    if (conflicting && conflicting.id !== member.id) {
      return { ok: false, error: 'errors.user_already_linked_in_group' };
    }

    // Unclaimed: require explicit confirmation. The page will render a
    // panel asking "你是 X 吗?"; on Yes we re-submit with claimMemberId.
    if (claimMemberId !== member.id) {
      return {
        ok: false,
        needsClaim: { memberId: member.id, memberName: member.displayName },
      };
    }

    // Confirmed: bind member ↔ user, ensure membership at the link's
    // assigned role, kill any other share links targeting this member
    // (they're now redundant and would only confuse things).
    const grantedRole: AssignableRole =
      (link.assignedRole as AssignableRole | null) ?? 'MEMBER';
    const nextMemberName = userCtx.user.displayName.slice(0, 40);

    const nameConflict = await prisma.member.findFirst({
      where: {
        groupId: member.groupId,
        id: { not: member.id },
        displayName: { equals: nextMemberName, mode: 'insensitive' },
      },
      select: { id: true },
    });
    if (nameConflict) return { ok: false, error: 'errors.member_name_taken' };

    await prisma.$transaction([
      prisma.member.update({
        where: { id: member.id },
        data: {
          linkedUserId: userCtx.user.id,
          // Sync the member's name to the linked account so other members
          // see who's behind it (matches the auto-claim flow).
          displayName: nextMemberName,
        },
      }),
      // Hard-kill all OTHER active links for the same member; this one
      // has done its job and we don't want stale URLs floating around
      // after a successful bind.
      prisma.shareLink.updateMany({
        where: {
          memberId: member.id,
          revokedAt: null,
          NOT: { id: link.id },
        },
        data: { revokedAt: new Date() },
      }),
      // Drop the share-sessions of every revoked sibling link so anyone
      // currently viewing through them is bounced on next request.
      prisma.shareSession.deleteMany({
        where: {
          shareLink: { memberId: member.id, NOT: { id: link.id } },
        },
      }),
    ]);
    await applyAssignedRole(userCtx.user.id, link.groupId, grantedRole);
    redirect(`/groups/${link.groupId}`);
  }

  // Default path: anonymous visitor (or expired/unbound link) gets a
  // share session. If the link is expired the session is automatically
  // degraded to read-only by `getCurrentShareSession`.
  await createShareSession(link.id);
  redirect(`/groups/${link.groupId}`);
}

/**
 * Upsert the user's GroupMembership at `desiredRole`. If a membership
 * already exists at a HIGHER rank we leave it alone — share-link claims
 * may upgrade authority but never silently demote (e.g. an existing
 * MANAGER who claims a MEMBER-grade link stays MANAGER).
 */
async function applyAssignedRole(
  userId: string,
  groupId: string,
  desiredRole: AssignableRole,
): Promise<void> {
  const current = await prisma.groupMembership.findUnique({
    where: { userId_groupId: { userId, groupId } },
    select: { role: true },
  });
  if (!current) {
    await prisma.groupMembership.create({
      data: { userId, groupId, role: desiredRole },
    });
    return;
  }
  if (ROLE_RANK[desiredRole] > ROLE_RANK[current.role as GroupRole]) {
    await prisma.groupMembership.update({
      where: { userId_groupId: { userId, groupId } },
      data: { role: desiredRole },
    });
  }
}
