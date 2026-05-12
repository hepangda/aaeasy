'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireGroupAccess } from '@/lib/auth/group-access';
import { requireUser } from '@/lib/auth/session';
import { generateSessionToken, hashSessionToken } from '@/lib/auth/tokens';

// Random 32-byte token, base64url-encoded; lives only in the URL path of
// `/s/[token]` and (after unlock) the share-session cookie.

export type ShareActionState = { ok: boolean; error?: string; token?: string };

/**
 * Allowed expiry choices in hours, plus a 4th "READ_ONLY" option that
 * means: never expires, but the visitor can only read.
 *
 * The UI is a fixed 4-option dropdown; the server enforces the same set.
 */
const expiresChoiceSchema = z.enum(['24', '48', '72', 'READ_ONLY']);
type ExpiresChoice = z.infer<typeof expiresChoiceSchema>;

/**
 * Role permanently granted to the visitor's account upon claim. OWNER is
 * intentionally excluded — ownership transfer goes through its own flow.
 */
const assignedRoleSchema = z.enum(['MANAGER', 'MEMBER', 'VIEWER']);

const memberShareSchema = z.object({
  groupId: z.string().min(1),
  memberId: z.string().min(1),
  expires: expiresChoiceSchema,
  /** Permission the link will permanently grant on claim. */
  assignedRole: assignedRoleSchema,
  /** Optional human-readable note used by the OWNER to label the link
   *  (e.g. "Alice's iPhone"). Never shown to the visitor. */
  label: z.string().trim().max(60).optional().or(z.literal('')),
});

function expiryFor(choice: ExpiresChoice): {
  expiresAt: Date | null;
  scope: 'READ' | 'WRITE';
} {
  if (choice === 'READ_ONLY') return { expiresAt: null, scope: 'READ' };
  const hours = Number(choice);
  return {
    expiresAt: new Date(Date.now() + hours * 60 * 60 * 1000),
    scope: 'WRITE',
  };
}

/**
 * Create a share link bound to a specific member. The OWNER picks one of
 * four expiry presets; 24/48/72h links are write-capable, the "READ_ONLY"
 * preset never expires but never allows writes.
 *
 * Permission: MANAGE_SHARES (OWNER + MANAGER).
 */
export async function createMemberShareLinkAction(
  _prev: ShareActionState,
  formData: FormData,
): Promise<ShareActionState> {
  const parsed = memberShareSchema.safeParse({
    groupId: formData.get('groupId'),
    memberId: formData.get('memberId'),
    expires: formData.get('expires'),
    assignedRole: formData.get('assignedRole'),
    label: formData.get('label') ?? undefined,
  });
  if (!parsed.success) return { ok: false, error: 'errors.invalid_input' };

  const { groupId, memberId, expires, assignedRole, label } = parsed.data;

  const access = await requireGroupAccess(groupId, 'MANAGE_SHARES');

  // Only OWNER may mint MANAGER-grade links — MANAGER cannot escalate
  // others into peers.
  if (assignedRole === 'MANAGER' && access.kind === 'user' && access.role !== 'OWNER') {
    return { ok: false, error: 'errors.forbidden' };
  }

  const member = await prisma.member.findUnique({
    where: { id: memberId },
    select: { groupId: true, displayName: true, linkedUserId: true },
  });
  if (!member || member.groupId !== groupId) {
    return { ok: false, error: 'errors.not_found' };
  }

  // Already-bound members can't be re-shared. The link's whole purpose is
  // to bind a member to an account; once bound, additional links would
  // either fail at claim ("already linked to another user") or, for the
  // same user, be redundant. UI hides the create button in this case.
  if (member.linkedUserId) {
    return { ok: false, error: 'errors.member_already_linked' };
  }

  const userCtx = await requireUser();

  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);
  const { expiresAt, scope } = expiryFor(expires);

  await prisma.shareLink.create({
    data: {
      groupId,
      memberId,
      tokenHash,
      scope,
      expiresAt,
      assignedRole,
      label: label?.trim() ? label.trim() : member.displayName,
      createdById: userCtx.user.id,
    },
  });

  revalidatePath(`/groups/${groupId}`);
  return { ok: true, token };
}

// ─── Revoke ────────────────────────────────────────────────────────────

export async function revokeShareLinkAction(input: {
  groupId: string;
  shareLinkId: string;
}): Promise<ShareActionState> {
  await requireGroupAccess(input.groupId, 'MANAGE_SHARES');
  await prisma.shareLink.update({
    where: { id: input.shareLinkId },
    data: { revokedAt: new Date() },
  });
  // Also kill any active share sessions for this link.
  await prisma.shareSession.deleteMany({ where: { shareLinkId: input.shareLinkId } });
  revalidatePath(`/groups/${input.groupId}`);
  return { ok: true };
}
