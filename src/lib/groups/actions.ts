'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth/session';
import { requireGroupAccess } from '@/lib/auth/group-access';
import { publish } from '@/lib/realtime/pgNotify';

// ─── Schemas ─────────────────────────────────────────────────────────────

const currencyRegex = /^[A-Z]{3}$/;

const createGroupSchema = z.object({
  name: z.string().trim().min(1, 'errors.group_name_required').max(64),
  defaultCurrency: z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => currencyRegex.test(v), { message: 'errors.invalid_currency' }),
  // Comma- or newline-separated initial member names.
  members: z.string().optional(),
});

const memberNameSchema = z.string().trim().min(1).max(40);

// ─── Result type ─────────────────────────────────────────────────────────

export type ActionState = { ok: boolean; error?: string };

// ─── Actions ─────────────────────────────────────────────────────────────

export async function createGroupAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireUser();

  const parsed = createGroupSchema.safeParse({
    name: formData.get('name'),
    defaultCurrency: formData.get('defaultCurrency') ?? 'CNY',
    members: formData.get('members') ?? undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'errors.invalid_input' };
  }

  const memberNames = (parsed.data.members ?? '')
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => memberNameSchema.parse(s))
    .slice(0, 50); // hard cap

  const taken = new Set<string>();
  for (const name of memberNames) {
    const key = name.toLocaleLowerCase();
    if (taken.has(key)) return { ok: false, error: 'errors.member_name_taken' };
    taken.add(key);
  }

  // Always include the creator as a member (linked).
  const ownerName = ctx.user.displayName.slice(0, 40);
  if (!taken.has(ownerName.toLocaleLowerCase())) {
    memberNames.unshift(ctx.user.displayName);
    taken.add(ownerName.toLocaleLowerCase());
  }

  const group = await prisma.group.create({
    data: {
      name: parsed.data.name,
      defaultCurrency: parsed.data.defaultCurrency,
      createdById: ctx.user.id,
      memberships: {
        create: { userId: ctx.user.id, role: 'OWNER' },
      },
      members: {
        create: memberNames.map((displayName, idx) => ({
          displayName: displayName.slice(0, 40),
          sortOrder: idx,
          // Link the first one matching the creator's display name.
          linkedUserId:
            displayName.toLocaleLowerCase() === ownerName.toLocaleLowerCase()
              ? ctx.user.id
              : null,
        })),
      },
    },
    select: { id: true },
  });

  revalidatePath('/groups');
  redirect(`/groups/${group.id}`);
}

const renameGroupSchema = z.object({
  groupId: z.string().min(1),
  name: z.string().trim().min(1).max(64),
});

export async function renameGroupAction(input: unknown): Promise<ActionState> {
  const parsed = renameGroupSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'errors.invalid_input' };
  await requireGroupAccess(parsed.data.groupId, 'MANAGE_MEMBERS');
  await prisma.group.update({
    where: { id: parsed.data.groupId },
    data: { name: parsed.data.name },
  });
  revalidatePath(`/groups/${parsed.data.groupId}`);
  revalidatePath('/groups');
  await publish({ type: 'GROUP_UPDATED', groupId: parsed.data.groupId }).catch(() => {});
  return { ok: true };
}

const addMemberSchema = z.object({
  groupId: z.string().min(1),
  displayName: memberNameSchema,
});

export async function addMemberAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = addMemberSchema.safeParse({
    groupId: formData.get('groupId'),
    displayName: formData.get('displayName'),
  });
  if (!parsed.success) return { ok: false, error: 'errors.invalid_input' };

  await requireGroupAccess(parsed.data.groupId, 'MANAGE_MEMBERS');

  const exists = await prisma.member.findFirst({
    where: {
      groupId: parsed.data.groupId,
      displayName: { equals: parsed.data.displayName, mode: 'insensitive' },
    },
    select: { id: true },
  });
  if (exists) return { ok: false, error: 'errors.member_name_taken' };

  const max = await prisma.member.findFirst({
    where: { groupId: parsed.data.groupId },
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  });
  await prisma.member.create({
    data: {
      groupId: parsed.data.groupId,
      displayName: parsed.data.displayName,
      sortOrder: (max?.sortOrder ?? -1) + 1,
    },
  });
  revalidatePath(`/groups/${parsed.data.groupId}`);
  await publish({ type: 'MEMBER_CHANGED', groupId: parsed.data.groupId }).catch(() => {});
  return { ok: true };
}

export async function removeMemberAction(input: {
  groupId: string;
  memberId: string;
}): Promise<ActionState> {
  await requireGroupAccess(input.groupId, 'MANAGE_MEMBERS');
  // Note: future expense FK will prevent deletion if member has references.
  await prisma.member.deleteMany({
    where: { id: input.memberId, groupId: input.groupId },
  });
  revalidatePath(`/groups/${input.groupId}`);
  await publish({ type: 'MEMBER_CHANGED', groupId: input.groupId }).catch(() => {});
  return { ok: true };
}

const renameMemberSchema = z.object({
  groupId: z.string().min(1),
  memberId: z.string().min(1),
  displayName: memberNameSchema,
});

/**
 * Rename a member in a group. Permission: MANAGE_MEMBERS (OWNER + MANAGER).
 * The display name is the only piece used everywhere downstream
 * (expenses, summaries, exports), so a single field update is enough.
 */
export async function renameMemberAction(input: {
  groupId: string;
  memberId: string;
  displayName: string;
}): Promise<ActionState> {
  const parsed = renameMemberSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'errors.invalid_input' };
  await requireGroupAccess(parsed.data.groupId, 'MANAGE_MEMBERS');

  const conflict = await prisma.member.findFirst({
    where: {
      groupId: parsed.data.groupId,
      id: { not: parsed.data.memberId },
      displayName: { equals: parsed.data.displayName, mode: 'insensitive' },
    },
    select: { id: true },
  });
  if (conflict) return { ok: false, error: 'errors.member_name_taken' };

  const updated = await prisma.member.updateMany({
    where: { id: parsed.data.memberId, groupId: parsed.data.groupId },
    data: { displayName: parsed.data.displayName },
  });
  if (updated.count === 0) return { ok: false, error: 'errors.not_found' };

  revalidatePath(`/groups/${parsed.data.groupId}`);
  await publish({ type: 'MEMBER_CHANGED', groupId: parsed.data.groupId }).catch(() => {});
  return { ok: true };
}

const memberRoleSchema = z.object({
  groupId: z.string().min(1),
  memberId: z.string().min(1),
  // OWNER is intentionally excluded — use the dedicated transfer action.
  role: z.enum(['MANAGER', 'MEMBER', 'VIEWER']),
});

/**
 * Change the GroupMembership role for the user linked to `memberId`.
 *
 * Permission: OWNER only. OWNER role transfer goes through
 * `transferOwnershipAction`. Refuses if the member is not bound to a
 * registered account.
 */
export async function setMemberRoleAction(input: {
  groupId: string;
  memberId: string;
  role: 'MANAGER' | 'MEMBER' | 'VIEWER';
}): Promise<ActionState> {
  const parsed = memberRoleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'errors.invalid_input' };
  // Role changes are OWNER-only by design — same authority bracket as
  // ownership transfer / group deletion.
  await requireGroupAccess(parsed.data.groupId, 'DELETE_GROUP');

  const member = await prisma.member.findFirst({
    where: { id: parsed.data.memberId, groupId: parsed.data.groupId },
    select: { linkedUserId: true },
  });
  if (!member) return { ok: false, error: 'errors.not_found' };
  if (!member.linkedUserId) return { ok: false, error: 'errors.target_not_linked' };

  const current = await prisma.groupMembership.findUnique({
    where: {
      userId_groupId: { userId: member.linkedUserId, groupId: parsed.data.groupId },
    },
    select: { role: true },
  });
  if (current?.role === 'OWNER') return { ok: false, error: 'errors.forbidden' };

  await prisma.groupMembership.upsert({
    where: {
      userId_groupId: { userId: member.linkedUserId, groupId: parsed.data.groupId },
    },
    create: {
      userId: member.linkedUserId,
      groupId: parsed.data.groupId,
      role: parsed.data.role,
    },
    update: { role: parsed.data.role },
  });

  revalidatePath(`/groups/${parsed.data.groupId}`);
  await publish({ type: 'MEMBER_CHANGED', groupId: parsed.data.groupId }).catch(() => {});
  return { ok: true };
}

/**
 * Unbind a member from its linked user account. The member row stays
 * (along with all expenses, splits, etc.); we just clear `linkedUserId`
 * and drop the corresponding GroupMembership so the user no longer has
 * access through this binding.
 *
 * Permission: MANAGE_MEMBERS (OWNER + MANAGER).
 */
export async function unlinkMemberAction(input: {
  groupId: string;
  memberId: string;
}): Promise<ActionState> {
  await requireGroupAccess(input.groupId, 'MANAGE_MEMBERS');

  const member = await prisma.member.findFirst({
    where: { id: input.memberId, groupId: input.groupId },
    select: { id: true, linkedUserId: true },
  });
  if (!member) return { ok: false, error: 'errors.not_found' };
  if (!member.linkedUserId) return { ok: true }; // nothing to do

  // Refuse to unbind a member whose linked user is an OWNER of this group:
  // the OWNER is always tied to a registered account by construction, so
  // unbinding them would orphan the group's authorship.
  const linkedRole = await prisma.groupMembership.findUnique({
    where: {
      userId_groupId: { userId: member.linkedUserId, groupId: input.groupId },
    },
    select: { role: true },
  });
  if (linkedRole?.role === 'OWNER') {
    return { ok: false, error: 'errors.forbidden' };
  }

  await prisma.$transaction([
    prisma.member.update({
      where: { id: member.id },
      data: { linkedUserId: null },
    }),
    // Revoke every non-OWNER membership the linked user holds in this
    // group. Their access (MEMBER / MANAGER / VIEWER) was granted via
    // this binding, so once the binding is severed the access goes too.
    // OWNER is excluded defensively — the guard above already refuses
    // to unbind a member whose linked user owns the group.
    prisma.groupMembership.deleteMany({
      where: {
        groupId: input.groupId,
        userId: member.linkedUserId,
        role: { in: ['MEMBER', 'MANAGER', 'VIEWER'] },
      },
    }),
  ]);

  revalidatePath(`/groups/${input.groupId}`);
  await publish({ type: 'MEMBER_CHANGED', groupId: input.groupId }).catch(() => {});
  return { ok: true };
}

export async function deleteGroupAction(groupId: string): Promise<void> {
  await requireGroupAccess(groupId, 'DELETE_GROUP');
  await prisma.group.delete({ where: { id: groupId } });
  revalidatePath('/groups');
  redirect('/groups');
}
