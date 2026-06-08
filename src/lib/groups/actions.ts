'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth/session';
import { requireGroupAccess } from '@/lib/auth/group-access';
import { publish } from '@/lib/realtime/pgNotify';

// ─── Schemas ─────────────────────────────────────────────────────────────

const memberChipSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('name'), text: z.string().trim().min(1).max(40) }),
  z.object({
    kind: z.literal('mention'),
    username: z
      .string()
      .trim()
      .toLowerCase()
      .min(3)
      .max(32)
      .regex(/^[a-z0-9_.-]+$/),
  }),
]);

const memberChipsSchema = z.array(memberChipSchema).max(50);

const createGroupSchema = z.object({
  name: z.string().trim().min(1, 'errors.group_name_required').max(64),
  defaultCurrency: z.literal('CNY').default('CNY'),
  /// JSON-serialized array of MemberChip — produced by <ChipInput>.
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

  // Parse the chip payload (JSON from <ChipInput>). Empty / missing → no
  // extra members; the creator is always added below regardless.
  let chips: z.infer<typeof memberChipsSchema> = [];
  const rawMembers = parsed.data.members?.trim();
  if (rawMembers) {
    let json: unknown;
    try {
      json = JSON.parse(rawMembers);
    } catch {
      return { ok: false, error: 'errors.invalid_input' };
    }
    const chipsParsed = memberChipsSchema.safeParse(json);
    if (!chipsParsed.success) {
      return { ok: false, error: 'errors.invalid_input' };
    }
    chips = chipsParsed.data;
  }

  // Resolve all @mention chips up-front so we know which become invitations
  // (target user exists) and which fall back to a literal-text Member row.
  const mentionUsernames = Array.from(
    new Set(chips.filter((c) => c.kind === 'mention').map((c) => c.username)),
  );
  const matchedUsers = mentionUsernames.length
    ? await prisma.user.findMany({
        where: { username: { in: mentionUsernames } },
        select: { id: true, username: true, displayName: true },
      })
    : [];
  const usernameToUser = new Map(
    matchedUsers
      .filter((u): u is { id: string; username: string; displayName: string } => !!u.username)
      .map((u) => [u.username, u]),
  );

  // Build the final ordered Member list. Creator first, then chips in the
  // order the user entered them. We enforce case-insensitive uniqueness on
  // the final display names to keep parity with the legacy behavior.
  const ownerName = ctx.user.displayName.slice(0, 40);
  type Pending =
    | { kind: 'creator'; displayName: string }
    | { kind: 'name'; displayName: string }
    | {
        kind: 'mention';
        displayName: string;
        invitedUser: { id: string; username: string };
      }
    | { kind: 'mention-unresolved'; displayName: string };

  const pendings: Pending[] = [{ kind: 'creator', displayName: ownerName }];
  const taken = new Set<string>([ownerName.toLocaleLowerCase()]);
  let hasUnresolvedMention = false;

  for (const chip of chips) {
    if (chip.kind === 'name') {
      const validated = memberNameSchema.parse(chip.text);
      const key = validated.toLocaleLowerCase();
      if (taken.has(key)) {
        return { ok: false, error: 'errors.member_name_taken' };
      }
      taken.add(key);
      pendings.push({ kind: 'name', displayName: validated });
    } else {
      const user = usernameToUser.get(chip.username);
      if (user) {
        if (user.id === ctx.user.id) {
          // Mentioning yourself collapses to "you" — already added as creator.
          continue;
        }
        // Use the target user's displayName for the Member row.
        const proposed = user.displayName.slice(0, 40);
        let displayName = proposed;
        let suffix = 2;
        while (taken.has(displayName.toLocaleLowerCase())) {
          // Disambiguate quietly so two users with the same display name can
          // both be invited at create time without blowing up the form.
          displayName = `${proposed} (${suffix++})`.slice(0, 40);
        }
        taken.add(displayName.toLocaleLowerCase());
        pendings.push({
          kind: 'mention',
          displayName,
          invitedUser: { id: user.id, username: user.username },
        });
      } else {
        const fallback = `@${chip.username}`.slice(0, 40);
        const key = fallback.toLocaleLowerCase();
        if (taken.has(key)) continue;
        taken.add(key);
        pendings.push({ kind: 'mention-unresolved', displayName: fallback });
        hasUnresolvedMention = true;
      }
    }
  }

  if (pendings.length > 50) {
    return { ok: false, error: 'errors.invalid_input' };
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
        create: pendings.map((p, idx) => ({
          displayName: p.displayName,
          sortOrder: idx,
          linkedUserId: p.kind === 'creator' ? ctx.user.id : null,
        })),
      },
    },
    select: {
      id: true,
      members: { select: { id: true, displayName: true, sortOrder: true } },
    },
  });

  // Send invitations for any resolved @mention chips. Use the in-flight
  // pending list to find the matching Member.id we just created.
  const memberByName = new Map(
    group.members.map((m) => [m.displayName.toLocaleLowerCase(), m.id]),
  );
  for (const p of pendings) {
    if (p.kind !== 'mention') continue;
    const memberId = memberByName.get(p.displayName.toLocaleLowerCase());
    if (!memberId) continue;
    try {
      await prisma.groupInvitation.create({
        data: {
          groupId: group.id,
          memberId,
          invitedUserId: p.invitedUser.id,
          invitedById: ctx.user.id,
          assignedRole: 'MEMBER',
        },
      });
    } catch (err) {
      // Partial-unique-index collision shouldn't happen on a freshly-created
      // Member, but swallow it defensively so the redirect still happens.
      if (
        !(err instanceof Prisma.PrismaClientKnownRequestError) ||
        err.code !== 'P2002'
      ) {
        throw err;
      }
    }
  }

  revalidatePath('/groups');
  // Stash a one-shot toast hint via redirect query when something was
  // ambiguous, so the new-group page can surface it after navigation.
  if (hasUnresolvedMention) {
    redirect(`/groups/${group.id}?notice=unresolved_mention`);
  }
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

  // Active references (not soft-deleted) block the delete — we preserve
  // historical balances. SettlementEntry has no soft-delete, every row
  // counts. Splits / payer rows attached to a soft-deleted expense are
  // already invisible to balance math, so they get cleaned up below.
  const [paid, split, settled] = await Promise.all([
    prisma.expense.count({
      where: {
        groupId: input.groupId,
        payerMemberId: input.memberId,
        deletedAt: null,
      },
    }),
    prisma.expenseSplit.count({
      where: {
        memberId: input.memberId,
        expense: { groupId: input.groupId, deletedAt: null },
      },
    }),
    prisma.settlementEntry.count({
      where: {
        groupId: input.groupId,
        OR: [{ fromMemberId: input.memberId }, { toMemberId: input.memberId }],
      },
    }),
  ]);
  if (paid + split + settled > 0) {
    return { ok: false, error: 'errors.member_in_use' };
  }

  // Tombstone splits and tombstone-payer expenses still hold the FK with
  // `onDelete: Restrict`. They are dead data (excluded from every query
  // and balance), so it's safe to hard-delete them with the member.
  try {
    await prisma.$transaction([
      prisma.expenseSplit.deleteMany({
        where: {
          memberId: input.memberId,
          expense: { groupId: input.groupId, deletedAt: { not: null } },
        },
      }),
      prisma.expense.deleteMany({
        where: {
          groupId: input.groupId,
          payerMemberId: input.memberId,
          deletedAt: { not: null },
        },
      }),
      prisma.member.deleteMany({
        where: { id: input.memberId, groupId: input.groupId },
      }),
    ]);
  } catch {
    return { ok: false, error: 'errors.delete_failed' };
  }

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

/**
 * Self-service: the current user leaves a group they have non-OWNER access
 * to. Mirrors `unlinkMemberAction` but is initiated by the affected user
 * themselves, so no MANAGE_MEMBERS check — just proof of current membership.
 * OWNER cannot leave (would orphan the group); they must transfer ownership
 * or delete the group instead.
 */
export async function leaveGroupAction(groupId: string): Promise<ActionState> {
  const ctx = await requireUser();
  const userId = ctx.user.id;

  const membership = await prisma.groupMembership.findUnique({
    where: { userId_groupId: { userId, groupId } },
    select: { role: true },
  });
  if (!membership) return { ok: false, error: 'errors.forbidden' };
  if (membership.role === 'OWNER') {
    return { ok: false, error: 'errors.cannot_leave_as_owner' };
  }

  await prisma.$transaction([
    prisma.member.updateMany({
      where: { groupId, linkedUserId: userId },
      data: { linkedUserId: null },
    }),
    prisma.groupMembership.delete({
      where: { userId_groupId: { userId, groupId } },
    }),
  ]);

  revalidatePath(`/groups/${groupId}`);
  revalidatePath('/groups');
  await publish({ type: 'MEMBER_CHANGED', groupId }).catch(() => {});
  return { ok: true };
}

export async function deleteGroupAction(groupId: string): Promise<ActionState> {
  await requireGroupAccess(groupId, 'DELETE_GROUP');
  // Soft delete — sets the tombstone column. Every read path filters
  // `deletedAt: null` so the group disappears from the UI and APIs while
  // its rows (expenses, settlements, audit history) stay intact.
  try {
    const res = await prisma.group.updateMany({
      where: { id: groupId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (res.count === 0) return { ok: false, error: 'errors.not_found' };
  } catch {
    return { ok: false, error: 'errors.delete_failed' };
  }
  revalidatePath('/groups');
  return { ok: true };
}
