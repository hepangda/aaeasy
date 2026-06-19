'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { GroupRole } from '@prisma/client';
import { prisma } from '@/lib/db';
import { getCurrentSession } from '@/lib/auth/session';
import { ROLE_RANK } from '@/lib/auth/roles';

const usernameSchema = z
  .string()
  .trim()
  .min(3, 'errors.username_too_short')
  .max(32, 'errors.username_too_long')
  .regex(/^[a-zA-Z0-9_.-]+$/, 'errors.username_invalid_chars')
  .transform((value) => value.toLowerCase());

export type AdminActionState = {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
};

async function requireSuperAdmin() {
  const ctx = await getCurrentSession();
  if (!ctx?.user.isSuperAdmin) throw new Error('FORBIDDEN');
  return ctx;
}

export async function addAllowedUsernameAction(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const ctx = await requireSuperAdmin();
  const parsed = usernameSchema.safeParse(formData.get('username'));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      error: 'errors.invalid_input',
      fieldErrors: { username: issue?.message ?? 'errors.invalid_input' },
    };
  }

  await prisma.allowedUsername.upsert({
    where: { username: parsed.data },
    create: { username: parsed.data, createdById: ctx.user.id },
    update: {},
  });
  revalidatePath('/account/admin/usernames');
  return { ok: true };
}

export async function deleteAllowedUsernameAction(formData: FormData): Promise<void> {
  await requireSuperAdmin();
  const parsed = usernameSchema.safeParse(formData.get('username'));
  if (!parsed.success) throw new Error('INVALID_USERNAME');

  await prisma.allowedUsername.deleteMany({ where: { username: parsed.data } });
  revalidatePath('/account/admin/usernames');
}

const mergeSchema = z
  .object({
    sourceUserId: z.string().trim().min(1),
    targetUserId: z.string().trim().min(1),
  })
  .refine((v) => v.sourceUserId !== v.targetUserId, {
    message: 'errors.merge_same_user',
    path: ['targetUserId'],
  });

function higherRole(a: GroupRole, b: GroupRole): GroupRole {
  return ROLE_RANK[a] >= ROLE_RANK[b] ? a : b;
}

/**
 * Merge `source` into `target`: re-point every user-owned row to `target`,
 * fold overlapping group memberships (keeping the higher role), unlink the
 * source from members the target already occupies, then delete the source
 * user. Never touches any ledger's money — Member slots and their
 * expenses/splits/settlements stay put; only the person↔account binding
 * (`Member.linkedUserId`) moves.
 */
export async function mergeUsersAction(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const ctx = await requireSuperAdmin();

  const parsed = mergeSchema.safeParse({
    sourceUserId: formData.get('sourceUserId'),
    targetUserId: formData.get('targetUserId'),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue?.message ?? 'errors.invalid_input' };
  }
  const { sourceUserId, targetUserId } = parsed.data;

  if (sourceUserId === ctx.user.id) {
    return { ok: false, error: 'errors.merge_source_is_self' };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const [source, target] = await Promise.all([
        tx.user.findUnique({ where: { id: sourceUserId } }),
        tx.user.findUnique({ where: { id: targetUserId } }),
      ]);
      if (!source || !target) throw new Error('errors.merge_user_not_found');
      if (source.isSuperAdmin) throw new Error('errors.merge_source_is_admin');

      // ── GroupMembership: fold overlaps (keep higher role), move the rest ──
      const [sourceMemberships, targetMemberships] = await Promise.all([
        tx.groupMembership.findMany({ where: { userId: sourceUserId } }),
        tx.groupMembership.findMany({ where: { userId: targetUserId } }),
      ]);
      const targetRoleByGroup = new Map(targetMemberships.map((m) => [m.groupId, m.role]));
      for (const m of sourceMemberships) {
        const targetRole = targetRoleByGroup.get(m.groupId);
        if (targetRole !== undefined) {
          const merged = higherRole(m.role, targetRole);
          if (merged !== targetRole) {
            await tx.groupMembership.update({
              where: { userId_groupId: { userId: targetUserId, groupId: m.groupId } },
              data: { role: merged },
            });
          }
          await tx.groupMembership.delete({
            where: { userId_groupId: { userId: sourceUserId, groupId: m.groupId } },
          });
        } else {
          await tx.groupMembership.update({
            where: { userId_groupId: { userId: sourceUserId, groupId: m.groupId } },
            data: { userId: targetUserId },
          });
        }
      }

      // ── Member.linkedUserId: same-ledger conflict → unlink; else → move ──
      const sourceMembers = await tx.member.findMany({
        where: { linkedUserId: sourceUserId },
        select: { id: true, groupId: true },
      });
      const targetLinkedGroups = new Set(
        (
          await tx.member.findMany({
            where: { linkedUserId: targetUserId },
            select: { groupId: true },
          })
        ).map((m) => m.groupId),
      );
      for (const m of sourceMembers) {
        if (targetLinkedGroups.has(m.groupId)) {
          await tx.member.update({ where: { id: m.id }, data: { linkedUserId: null } });
        } else {
          await tx.member.update({ where: { id: m.id }, data: { linkedUserId: targetUserId } });
          targetLinkedGroups.add(m.groupId);
        }
      }

      // ── GroupInvitation.invitedUserId: respect partial-unique on PENDING ──
      const sourceInvites = await tx.groupInvitation.findMany({
        where: { invitedUserId: sourceUserId },
        select: { id: true, memberId: true, status: true },
      });
      const targetPendingMembers = new Set(
        (
          await tx.groupInvitation.findMany({
            where: { invitedUserId: targetUserId, status: 'PENDING' },
            select: { memberId: true },
          })
        ).map((i) => i.memberId),
      );
      for (const inv of sourceInvites) {
        if (inv.status === 'PENDING' && targetPendingMembers.has(inv.memberId)) {
          await tx.groupInvitation.delete({ where: { id: inv.id } });
        } else {
          await tx.groupInvitation.update({
            where: { id: inv.id },
            data: { invitedUserId: targetUserId },
          });
        }
      }

      // ── Plain re-points (no unique/composite conflicts possible) ──
      await Promise.all([
        tx.passwordCredential.updateMany({
          where: { userId: sourceUserId },
          data: { userId: targetUserId },
        }),
        tx.passkeyCredential.updateMany({
          where: { userId: sourceUserId },
          data: { userId: targetUserId },
        }),
        tx.session.updateMany({
          where: { userId: sourceUserId },
          data: { userId: targetUserId },
        }),
        tx.groupInvitation.updateMany({
          where: { invitedById: sourceUserId },
          data: { invitedById: targetUserId },
        }),
        tx.group.updateMany({
          where: { createdById: sourceUserId },
          data: { createdById: targetUserId },
        }),
        tx.shareLink.updateMany({
          where: { createdById: sourceUserId },
          data: { createdById: targetUserId },
        }),
        tx.expense.updateMany({
          where: { createdByUserId: sourceUserId },
          data: { createdByUserId: targetUserId },
        }),
        tx.receipt.updateMany({
          where: { uploadedById: sourceUserId },
          data: { uploadedById: targetUserId },
        }),
        tx.settlement.updateMany({
          where: { createdById: sourceUserId },
          data: { createdById: targetUserId },
        }),
        tx.settlementEntry.updateMany({
          where: { createdById: sourceUserId },
          data: { createdById: targetUserId },
        }),
      ]);

      // Short-lived WebAuthn challenges — just drop the source's.
      await tx.authChallenge.deleteMany({ where: { userId: sourceUserId } });

      await tx.user.delete({ where: { id: sourceUserId } });
    });
  } catch (err) {
    const code = err instanceof Error ? err.message : '';
    const known = code.startsWith('errors.') ? code : 'errors.merge_failed';
    return { ok: false, error: known };
  }

  revalidatePath('/account/admin/users');
  revalidatePath('/account');
  return { ok: true };
}
