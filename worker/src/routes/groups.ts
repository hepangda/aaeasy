import {
  createGroupSchema,
  createMemberSchema,
  createShareLinkSchema,
  inviteMemberSchema,
  KEYFORGE_ALIAS_MAX_LENGTH,
  KEYFORGE_ALIAS_MIN_LENGTH,
  KEYFORGE_ALIAS_PATTERN,
  renameGroupSchema,
  updateMemberSchema,
  type GroupAccessDto,
} from '@aaeasy/contracts';
import {
  expenseSplits,
  expenses,
  groupInvitations,
  groupMemberships,
  groups,
  members,
  settlements,
  settlementEntries,
  shareLinks,
  shareSessions,
  users,
} from '@aaeasy/db/schema';
import { createId } from '@paralleldrive/cuid2';
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  max,
  ne,
  or,
  sql,
} from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../app-env';
import { isAllowed, requireGroupAccess, type GroupAccess } from '../auth/access';
import { linkUserToMember } from '../auth/claim';
import { createShareSession, getCurrentSession, requireUser } from '../auth/session';
import { generateToken, sha256 } from '../lib/crypto';
import { getClientIp } from '../lib/request';
import { fieldErrors } from '../lib/validation';
import { bumpGroupRevision, scheduleGroupEvent } from '../realtime/events';

export const groupRoutes = new Hono<AppEnv>();

const idListSchema = z.object({ ids: z.array(z.string().min(1)).min(1).max(100) });
const unlockSchema = z.object({
  token: z.string().min(10).max(128),
  claimMemberId: z.string().min(1).optional(),
});

function actorId(access: GroupAccess): string {
  return access.kind === 'user' ? access.userId : access.shareLinkId;
}

function accessDto(access: GroupAccess): GroupAccessDto {
  return {
    kind: access.kind,
    userId: access.kind === 'user' ? access.userId : null,
    role: access.kind === 'user' ? access.role : null,
    scope: access.kind === 'share' ? access.scope : null,
    linkedMemberId: access.kind === 'user' ? access.linkedMemberId : access.boundMemberId,
    bypass: access.kind === 'user' ? access.bypass : null,
    canWriteExpense: isAllowed(access, 'WRITE_EXPENSE'),
    canManageMembers: isAllowed(access, 'MANAGE_MEMBERS'),
    canSettle: isAllowed(access, 'SETTLE'),
    canDeleteGroup: isAllowed(access, 'DELETE_GROUP'),
  };
}

function uniqueError(error: unknown): boolean {
  return Boolean(
    error && typeof error === 'object' && 'code' in error && String(error.code) === '23505',
  );
}

async function rateLimit(
  c: Context<AppEnv>,
  key: string,
  input: { windowMs: number; max: number },
) {
  const result = await c.env.RATE_LIMITER.getByName(key).consume(input);
  if (!result.ok) {
    c.header('Retry-After', String(Math.max(1, Math.ceil((result.retryAfterMs ?? 1000) / 1000))));
  }
  return result.ok;
}

groupRoutes.get('/groups', async (c) => {
  const session = await requireUser(c);
  const rows = await c.var.db
    .select({
      id: groups.id,
      name: groups.name,
      status: groups.status,
      defaultCurrency: groups.defaultCurrency,
      role: groupMemberships.role,
      createdAt: groups.createdAt,
      updatedAt: groups.updatedAt,
    })
    .from(groupMemberships)
    .innerJoin(groups, eq(groups.id, groupMemberships.groupId))
    .where(and(eq(groupMemberships.userId, session.user.id), isNull(groups.deletedAt)))
    .orderBy(desc(groups.updatedAt));

  const groupIds = rows.map((row) => row.id);
  const memberCounts =
    groupIds.length === 0
      ? []
      : await c.var.db
          .select({ groupId: members.groupId, memberCount: count() })
          .from(members)
          .where(inArray(members.groupId, groupIds))
          .groupBy(members.groupId);
  const countByGroup = new Map(memberCounts.map((row) => [row.groupId, row.memberCount]));

  const invitations = await c.var.db
    .select({
      id: groupInvitations.id,
      groupId: groupInvitations.groupId,
      memberId: groupInvitations.memberId,
      assignedRole: groupInvitations.assignedRole,
      message: groupInvitations.message,
      createdAt: groupInvitations.createdAt,
      groupName: groups.name,
      memberDisplayName: members.displayName,
      inviterId: groupInvitations.invitedById,
      inviterDisplayName: users.displayName,
      inviterUsername: users.username,
    })
    .from(groupInvitations)
    .innerJoin(groups, eq(groups.id, groupInvitations.groupId))
    .innerJoin(members, eq(members.id, groupInvitations.memberId))
    .leftJoin(users, eq(users.id, groupInvitations.invitedById))
    .where(
      and(
        eq(groupInvitations.invitedUserId, session.user.id),
        eq(groupInvitations.status, 'PENDING'),
        isNull(groups.deletedAt),
      ),
    )
    .orderBy(desc(groupInvitations.createdAt));

  return c.json({
    groups: rows.map((row) => ({
      ...row,
      memberCount: countByGroup.get(row.id) ?? 0,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
    invitations: invitations.map((invitation) => ({
      ...invitation,
      createdAt: invitation.createdAt.toISOString(),
    })),
  });
});

groupRoutes.post('/groups', async (c) => {
  const session = await requireUser(c);
  const parsed = createGroupSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(
      { ok: false, error: 'errors.invalid_input', fieldErrors: fieldErrors(parsed.error) },
      400,
    );
  }

  const mentionUsernames = [
    ...new Set(
      parsed.data.members
        .filter((member) => member.kind === 'mention')
        .map((member) => member.username),
    ),
  ];
  const matchedUsers =
    mentionUsernames.length === 0
      ? []
      : await c.var.db
          .select({ id: users.id, username: users.username, displayName: users.displayName })
          .from(users)
          .where(inArray(sql`lower(${users.username})`, mentionUsernames));
  const usersByUsername = new Map(
    matchedUsers.flatMap((user) =>
      user.username ? ([[user.username.toLowerCase(), user]] as const) : [],
    ),
  );

  type PendingMember = {
    id: string;
    displayName: string;
    linkedUserId: string | null;
    invitedUserId: string | null;
  };
  const ownerName = session.user.displayName.slice(0, 40);
  const pending: PendingMember[] = [
    { id: createId(), displayName: ownerName, linkedUserId: session.user.id, invitedUserId: null },
  ];
  const taken = new Set([ownerName.toLocaleLowerCase()]);
  let unresolvedMention = false;

  for (const chip of parsed.data.members) {
    if (chip.kind === 'name') {
      const key = chip.text.toLocaleLowerCase();
      if (taken.has(key)) return c.json({ ok: false, error: 'errors.member_name_taken' }, 409);
      taken.add(key);
      pending.push({
        id: createId(),
        displayName: chip.text,
        linkedUserId: null,
        invitedUserId: null,
      });
      continue;
    }

    const user = usersByUsername.get(chip.username);
    if (user) {
      if (user.id === session.user.id) continue;
      const proposed = user.displayName.slice(0, 40);
      let displayName = proposed;
      let suffix = 2;
      while (taken.has(displayName.toLocaleLowerCase())) {
        displayName = `${proposed} (${suffix++})`.slice(0, 40);
      }
      taken.add(displayName.toLocaleLowerCase());
      pending.push({
        id: createId(),
        displayName,
        linkedUserId: null,
        invitedUserId: user.id,
      });
    } else {
      const displayName = `@${chip.username}`.slice(0, 40);
      const key = displayName.toLocaleLowerCase();
      if (taken.has(key)) continue;
      taken.add(key);
      unresolvedMention = true;
      pending.push({ id: createId(), displayName, linkedUserId: null, invitedUserId: null });
    }
  }

  const groupId = createId();
  const now = new Date();
  await c.var.db.transaction(async (tx) => {
    await tx.insert(groups).values({
      id: groupId,
      name: parsed.data.name,
      defaultCurrency: parsed.data.defaultCurrency,
      createdById: session.user.id,
      updatedAt: now,
    });
    await tx.insert(groupMemberships).values({ userId: session.user.id, groupId, role: 'OWNER' });
    await tx.insert(members).values(
      pending.map((member, index) => ({
        id: member.id,
        groupId,
        displayName: member.displayName,
        linkedUserId: member.linkedUserId,
        sortOrder: index,
      })),
    );
    const invitations = pending.filter(
      (member): member is PendingMember & { invitedUserId: string } =>
        member.invitedUserId !== null,
    );
    if (invitations.length > 0) {
      await tx.insert(groupInvitations).values(
        invitations.map((invitation) => ({
          id: createId(),
          groupId,
          memberId: invitation.id,
          invitedUserId: invitation.invitedUserId,
          invitedById: session.user.id,
          assignedRole: 'MEMBER' as const,
        })),
      );
    }
  });

  return c.json({ ok: true, groupId, unresolvedMention }, 201);
});

groupRoutes.get('/groups/:groupId', async (c) => {
  const groupId = c.req.param('groupId');
  const access = await requireGroupAccess(c, groupId, 'READ_GROUP');
  const [group] = await c.var.db.select().from(groups).where(eq(groups.id, groupId)).limit(1);
  if (!group) return c.json({ error: 'NOT_FOUND' }, 404);

  const memberRows = await c.var.db
    .select({
      id: members.id,
      displayName: members.displayName,
      linkedUserId: members.linkedUserId,
      linkedUsername: users.username,
      color: members.color,
      sortOrder: members.sortOrder,
      createdAt: members.createdAt,
    })
    .from(members)
    .leftJoin(users, eq(users.id, members.linkedUserId))
    .where(eq(members.groupId, groupId))
    .orderBy(asc(members.sortOrder), asc(members.createdAt));
  const memberships = await c.var.db
    .select({ userId: groupMemberships.userId, role: groupMemberships.role })
    .from(groupMemberships)
    .where(eq(groupMemberships.groupId, groupId));
  const roles = new Map(memberships.map((membership) => [membership.userId, membership.role]));
  const canManage = isAllowed(access, 'MANAGE_MEMBERS');

  const linkRows = canManage
    ? await c.var.db
        .select()
        .from(shareLinks)
        .where(eq(shareLinks.groupId, groupId))
        .orderBy(desc(shareLinks.createdAt))
    : [];
  const invitationRows = canManage
    ? await c.var.db
        .select({
          id: groupInvitations.id,
          memberId: groupInvitations.memberId,
          assignedRole: groupInvitations.assignedRole,
          createdAt: groupInvitations.createdAt,
          invitedUserId: groupInvitations.invitedUserId,
          invitedById: groupInvitations.invitedById,
        })
        .from(groupInvitations)
        .where(and(eq(groupInvitations.groupId, groupId), eq(groupInvitations.status, 'PENDING')))
        .orderBy(desc(groupInvitations.createdAt))
    : [];
  const invitationUserIds = [
    ...new Set(
      invitationRows.flatMap(
        (row) => [row.invitedUserId, row.invitedById].filter(Boolean) as string[],
      ),
    ),
  ];
  const invitationUsers =
    invitationUserIds.length === 0
      ? []
      : await c.var.db
          .select({ id: users.id, displayName: users.displayName, username: users.username })
          .from(users)
          .where(inArray(users.id, invitationUserIds));
  const invitationUserById = new Map(invitationUsers.map((user) => [user.id, user]));
  const [latestSettlement] = await c.var.db
    .select({ id: settlements.id })
    .from(settlements)
    .where(eq(settlements.groupId, groupId))
    .orderBy(desc(settlements.createdAt))
    .limit(1);

  return c.json({
    group: {
      ...group,
      revision: group.revision.toString(),
      createdAt: group.createdAt.toISOString(),
      updatedAt: group.updatedAt.toISOString(),
      deletedAt: group.deletedAt?.toISOString() ?? null,
    },
    access: accessDto(access),
    members: memberRows.map((member) => ({
      ...member,
      role: member.linkedUserId ? (roles.get(member.linkedUserId) ?? null) : null,
      createdAt: member.createdAt.toISOString(),
    })),
    shareLinks: linkRows.map((link) => ({
      id: link.id,
      memberId: link.memberId,
      label: link.label,
      scope: link.scope,
      assignedRole: link.assignedRole,
      createdAt: link.createdAt.toISOString(),
      expiresAt: link.expiresAt?.toISOString() ?? null,
      expired: Boolean(link.expiresAt && link.expiresAt <= new Date()),
      revoked: link.revokedAt !== null,
    })),
    pendingInvitations: invitationRows.map((invitation) => ({
      ...invitation,
      createdAt: invitation.createdAt.toISOString(),
      invitedUser: invitationUserById.get(invitation.invitedUserId) ?? null,
      invitedBy: invitation.invitedById
        ? (invitationUserById.get(invitation.invitedById) ?? null)
        : null,
    })),
    latestSettlementId: latestSettlement?.id ?? null,
  });
});

groupRoutes.patch('/groups/:groupId', async (c) => {
  const groupId = c.req.param('groupId');
  const parsed = renameGroupSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ ok: false, error: 'errors.invalid_input' }, 400);
  const access = await requireGroupAccess(c, groupId, 'MANAGE_MEMBERS');
  const revision = await c.var.db.transaction(async (tx) => {
    await tx.update(groups).set({ name: parsed.data.name }).where(eq(groups.id, groupId));
    return bumpGroupRevision(tx, groupId);
  });
  scheduleGroupEvent(c, groupId, { revision, type: 'group.updated', actorId: actorId(access) });
  return c.json({ ok: true, revision });
});

groupRoutes.delete('/groups/:groupId', async (c) => {
  const groupId = c.req.param('groupId');
  await requireGroupAccess(c, groupId, 'DELETE_GROUP');
  const updated = await c.var.db
    .update(groups)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(groups.id, groupId), isNull(groups.deletedAt)))
    .returning({ id: groups.id });
  if (updated.length === 0) return c.json({ ok: false, error: 'errors.not_found' }, 404);
  return c.json({ ok: true });
});

groupRoutes.post('/groups/:groupId/members', async (c) => {
  const groupId = c.req.param('groupId');
  const parsed = createMemberSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ ok: false, error: 'errors.invalid_input' }, 400);
  const access = await requireGroupAccess(c, groupId, 'MANAGE_MEMBERS');
  const [conflict] = await c.var.db
    .select({ id: members.id })
    .from(members)
    .where(
      and(
        eq(members.groupId, groupId),
        sql`lower(${members.displayName}) = ${parsed.data.displayName.toLowerCase()}`,
      ),
    )
    .limit(1);
  if (conflict) return c.json({ ok: false, error: 'errors.member_name_taken' }, 409);
  const [{ highest }] = await c.var.db
    .select({ highest: max(members.sortOrder) })
    .from(members)
    .where(eq(members.groupId, groupId));
  const memberId = createId();
  const revision = await c.var.db.transaction(async (tx) => {
    await tx.insert(members).values({
      id: memberId,
      groupId,
      displayName: parsed.data.displayName,
      sortOrder: (highest ?? -1) + 1,
    });
    return bumpGroupRevision(tx, groupId);
  });
  scheduleGroupEvent(c, groupId, {
    revision,
    type: 'member.changed',
    entityId: memberId,
    actorId: actorId(access),
  });
  return c.json({ ok: true, memberId, revision }, 201);
});

groupRoutes.patch('/groups/:groupId/members/:memberId', async (c) => {
  const groupId = c.req.param('groupId');
  const memberId = c.req.param('memberId');
  const parsed = updateMemberSchema
    .pick({ displayName: true })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success || !parsed.data.displayName) {
    return c.json({ ok: false, error: 'errors.invalid_input' }, 400);
  }
  const access = await requireGroupAccess(c, groupId, 'MANAGE_MEMBERS');
  const [conflict] = await c.var.db
    .select({ id: members.id })
    .from(members)
    .where(
      and(
        eq(members.groupId, groupId),
        ne(members.id, memberId),
        sql`lower(${members.displayName}) = ${parsed.data.displayName.toLowerCase()}`,
      ),
    )
    .limit(1);
  if (conflict) return c.json({ ok: false, error: 'errors.member_name_taken' }, 409);
  const revision = await c.var.db.transaction(async (tx) => {
    const updated = await tx
      .update(members)
      .set({ displayName: parsed.data.displayName })
      .where(and(eq(members.id, memberId), eq(members.groupId, groupId)))
      .returning({ id: members.id });
    if (updated.length === 0) return null;
    return bumpGroupRevision(tx, groupId);
  });
  if (!revision) return c.json({ ok: false, error: 'errors.not_found' }, 404);
  scheduleGroupEvent(c, groupId, {
    revision,
    type: 'member.changed',
    entityId: memberId,
    actorId: actorId(access),
  });
  return c.json({ ok: true, revision });
});

groupRoutes.delete('/groups/:groupId/members/:memberId', async (c) => {
  const groupId = c.req.param('groupId');
  const memberId = c.req.param('memberId');
  const access = await requireGroupAccess(c, groupId, 'MANAGE_MEMBERS');
  const [[paid], [split], [settled]] = await Promise.all([
    c.var.db
      .select({ total: count() })
      .from(expenses)
      .where(
        and(
          eq(expenses.groupId, groupId),
          eq(expenses.payerMemberId, memberId),
          isNull(expenses.deletedAt),
        ),
      ),
    c.var.db
      .select({ total: count() })
      .from(expenseSplits)
      .innerJoin(expenses, eq(expenses.id, expenseSplits.expenseId))
      .where(
        and(
          eq(expenseSplits.memberId, memberId),
          eq(expenses.groupId, groupId),
          isNull(expenses.deletedAt),
        ),
      ),
    c.var.db
      .select({ total: count() })
      .from(settlementEntries)
      .where(
        and(
          eq(settlementEntries.groupId, groupId),
          or(
            eq(settlementEntries.fromMemberId, memberId),
            eq(settlementEntries.toMemberId, memberId),
          ),
        ),
      ),
  ]);
  if ((paid?.total ?? 0) + (split?.total ?? 0) + (settled?.total ?? 0) > 0) {
    return c.json({ ok: false, error: 'errors.member_in_use' }, 409);
  }

  const revision = await c.var.db.transaction(async (tx) => {
    const tombstonedExpenseIds = tx
      .select({ id: expenses.id })
      .from(expenses)
      .where(and(eq(expenses.groupId, groupId), isNotNull(expenses.deletedAt)));
    await tx
      .delete(expenseSplits)
      .where(
        and(
          eq(expenseSplits.memberId, memberId),
          inArray(expenseSplits.expenseId, tombstonedExpenseIds),
        ),
      );
    await tx
      .delete(expenses)
      .where(
        and(
          eq(expenses.groupId, groupId),
          eq(expenses.payerMemberId, memberId),
          isNotNull(expenses.deletedAt),
        ),
      );
    const deleted = await tx
      .delete(members)
      .where(and(eq(members.id, memberId), eq(members.groupId, groupId)))
      .returning({ id: members.id });
    if (deleted.length === 0) return null;
    return bumpGroupRevision(tx, groupId);
  });
  if (!revision) return c.json({ ok: false, error: 'errors.not_found' }, 404);
  scheduleGroupEvent(c, groupId, {
    revision,
    type: 'member.changed',
    entityId: memberId,
    actorId: actorId(access),
  });
  return c.json({ ok: true, revision });
});

groupRoutes.put('/groups/:groupId/members/:memberId/role', async (c) => {
  const groupId = c.req.param('groupId');
  const memberId = c.req.param('memberId');
  const parsed = updateMemberSchema
    .pick({ role: true })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success || !parsed.data.role) {
    return c.json({ ok: false, error: 'errors.invalid_input' }, 400);
  }
  const access = await requireGroupAccess(c, groupId, 'DELETE_GROUP');
  const [member] = await c.var.db
    .select({ linkedUserId: members.linkedUserId })
    .from(members)
    .where(and(eq(members.id, memberId), eq(members.groupId, groupId)))
    .limit(1);
  if (!member) return c.json({ ok: false, error: 'errors.not_found' }, 404);
  if (!member.linkedUserId) return c.json({ ok: false, error: 'errors.target_not_linked' }, 409);
  const [current] = await c.var.db
    .select({ role: groupMemberships.role })
    .from(groupMemberships)
    .where(
      and(eq(groupMemberships.userId, member.linkedUserId), eq(groupMemberships.groupId, groupId)),
    )
    .limit(1);
  if (current?.role === 'OWNER') return c.json({ ok: false, error: 'errors.forbidden' }, 403);
  const revision = await c.var.db.transaction(async (tx) => {
    await tx
      .insert(groupMemberships)
      .values({ userId: member.linkedUserId!, groupId, role: parsed.data.role! })
      .onConflictDoUpdate({
        target: [groupMemberships.userId, groupMemberships.groupId],
        set: { role: parsed.data.role! },
      });
    return bumpGroupRevision(tx, groupId);
  });
  scheduleGroupEvent(c, groupId, {
    revision,
    type: 'member.changed',
    entityId: memberId,
    actorId: actorId(access),
  });
  return c.json({ ok: true, revision });
});

groupRoutes.delete('/groups/:groupId/members/:memberId/link', async (c) => {
  const groupId = c.req.param('groupId');
  const memberId = c.req.param('memberId');
  const access = await requireGroupAccess(c, groupId, 'MANAGE_MEMBERS');
  const [member] = await c.var.db
    .select({ linkedUserId: members.linkedUserId })
    .from(members)
    .where(and(eq(members.id, memberId), eq(members.groupId, groupId)))
    .limit(1);
  if (!member) return c.json({ ok: false, error: 'errors.not_found' }, 404);
  if (!member.linkedUserId) return c.json({ ok: true });
  const [membership] = await c.var.db
    .select({ role: groupMemberships.role })
    .from(groupMemberships)
    .where(
      and(eq(groupMemberships.userId, member.linkedUserId), eq(groupMemberships.groupId, groupId)),
    )
    .limit(1);
  if (membership?.role === 'OWNER') return c.json({ ok: false, error: 'errors.forbidden' }, 403);
  const revision = await c.var.db.transaction(async (tx) => {
    await tx.update(members).set({ linkedUserId: null }).where(eq(members.id, memberId));
    await tx
      .delete(groupMemberships)
      .where(
        and(
          eq(groupMemberships.userId, member.linkedUserId!),
          eq(groupMemberships.groupId, groupId),
          inArray(groupMemberships.role, ['MEMBER', 'MANAGER', 'VIEWER']),
        ),
      );
    return bumpGroupRevision(tx, groupId);
  });
  scheduleGroupEvent(c, groupId, {
    revision,
    type: 'member.changed',
    entityId: memberId,
    actorId: actorId(access),
  });
  return c.json({ ok: true, revision });
});

groupRoutes.post('/groups/:groupId/leave', async (c) => {
  const groupId = c.req.param('groupId');
  const session = await requireUser(c);
  const [membership] = await c.var.db
    .select({ role: groupMemberships.role })
    .from(groupMemberships)
    .where(and(eq(groupMemberships.userId, session.user.id), eq(groupMemberships.groupId, groupId)))
    .limit(1);
  if (!membership) return c.json({ ok: false, error: 'errors.forbidden' }, 403);
  if (membership.role === 'OWNER') {
    return c.json({ ok: false, error: 'errors.cannot_leave_as_owner' }, 409);
  }
  const revision = await c.var.db.transaction(async (tx) => {
    await tx
      .update(members)
      .set({ linkedUserId: null })
      .where(and(eq(members.groupId, groupId), eq(members.linkedUserId, session.user.id)));
    await tx
      .delete(groupMemberships)
      .where(
        and(eq(groupMemberships.userId, session.user.id), eq(groupMemberships.groupId, groupId)),
      );
    return bumpGroupRevision(tx, groupId);
  });
  scheduleGroupEvent(c, groupId, {
    revision,
    type: 'member.changed',
    actorId: session.user.id,
  });
  return c.json({ ok: true, revision });
});

groupRoutes.post('/groups/:groupId/share-links', async (c) => {
  const groupId = c.req.param('groupId');
  const parsed = createShareLinkSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ ok: false, error: 'errors.invalid_input' }, 400);
  const access = await requireGroupAccess(c, groupId, 'MANAGE_SHARES');
  if (access.kind !== 'user') return c.json({ ok: false, error: 'errors.forbidden' }, 403);
  if (parsed.data.assignedRole === 'MANAGER' && access.role !== 'OWNER') {
    return c.json({ ok: false, error: 'errors.forbidden' }, 403);
  }
  if (!parsed.data.memberId && (parsed.data.scope !== 'READ' || parsed.data.assignedRole)) {
    return c.json({ ok: false, error: 'errors.invalid_input' }, 400);
  }

  let defaultLabel: string | null = null;
  if (parsed.data.memberId) {
    const [member] = await c.var.db
      .select({ displayName: members.displayName, linkedUserId: members.linkedUserId })
      .from(members)
      .where(and(eq(members.id, parsed.data.memberId), eq(members.groupId, groupId)))
      .limit(1);
    if (!member) return c.json({ ok: false, error: 'errors.not_found' }, 404);
    if (member.linkedUserId) {
      return c.json({ ok: false, error: 'errors.member_already_linked' }, 409);
    }
    defaultLabel = member.displayName;
  }

  const token = generateToken();
  const linkId = createId();
  await c.var.db.insert(shareLinks).values({
    id: linkId,
    groupId,
    tokenHash: await sha256(token),
    scope: parsed.data.memberId ? parsed.data.scope : 'READ',
    assignedRole: parsed.data.memberId ? (parsed.data.assignedRole ?? 'MEMBER') : null,
    memberId: parsed.data.memberId ?? null,
    expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
    label: parsed.data.label || defaultLabel,
    createdById: access.userId,
  });
  return c.json({ ok: true, id: linkId, token }, 201);
});

groupRoutes.delete('/groups/:groupId/share-links/:shareLinkId', async (c) => {
  const groupId = c.req.param('groupId');
  await requireGroupAccess(c, groupId, 'MANAGE_SHARES');
  const shareLinkId = c.req.param('shareLinkId');
  const updated = await c.var.db
    .update(shareLinks)
    .set({ revokedAt: new Date() })
    .where(and(eq(shareLinks.id, shareLinkId), eq(shareLinks.groupId, groupId)))
    .returning({ id: shareLinks.id });
  if (updated.length === 0) return c.json({ ok: false, error: 'errors.not_found' }, 404);
  await c.var.db.delete(shareSessions).where(eq(shareSessions.shareLinkId, shareLinkId));
  return c.json({ ok: true });
});

groupRoutes.post('/share/unlock', async (c) => {
  const allowed = await rateLimit(c, `share:unlock:ip:${getClientIp(c)}`, {
    windowMs: 10 * 60_000,
    max: 30,
  });
  if (!allowed) return c.json({ ok: false, error: 'errors.rate_limited' }, 429);
  const parsed = unlockSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ ok: false, error: 'errors.invalid_link' }, 400);
  const [row] = await c.var.db
    .select({ link: shareLinks, deletedAt: groups.deletedAt })
    .from(shareLinks)
    .innerJoin(groups, eq(groups.id, shareLinks.groupId))
    .where(eq(shareLinks.tokenHash, await sha256(parsed.data.token)))
    .limit(1);
  if (!row || row.link.revokedAt || row.deletedAt) {
    return c.json({ ok: false, error: 'errors.invalid_link' }, 404);
  }

  const expired = Boolean(row.link.expiresAt && row.link.expiresAt <= new Date());
  const session = await getCurrentSession(c);
  if (row.link.memberId && session && !expired) {
    const [member] = await c.var.db
      .select({
        id: members.id,
        displayName: members.displayName,
        linkedUserId: members.linkedUserId,
        groupId: members.groupId,
      })
      .from(members)
      .where(eq(members.id, row.link.memberId))
      .limit(1);
    if (!member) return c.json({ ok: false, error: 'errors.invalid_link' }, 404);
    if (member.linkedUserId && member.linkedUserId !== session.user.id) {
      return c.json({ ok: false, error: 'errors.member_already_claimed' }, 409);
    }
    const [conflicting] = await c.var.db
      .select({ id: members.id })
      .from(members)
      .where(and(eq(members.groupId, member.groupId), eq(members.linkedUserId, session.user.id)))
      .limit(1);
    if (conflicting && conflicting.id !== member.id) {
      return c.json({ ok: false, error: 'errors.user_already_linked_in_group' }, 409);
    }
    if (member.linkedUserId === null && parsed.data.claimMemberId !== member.id) {
      return c.json({
        ok: false,
        needsClaim: { memberId: member.id, memberName: member.displayName },
      });
    }

    const grantedRole =
      row.link.assignedRole === 'MANAGER' ||
      row.link.assignedRole === 'VIEWER' ||
      row.link.assignedRole === 'MEMBER'
        ? row.link.assignedRole
        : 'MEMBER';
    const result = await c.var.db.transaction(async (tx) => {
      const linked = await linkUserToMember(tx, {
        userId: session.user.id,
        memberId: member.id,
        grantedRole,
      });
      if (!linked.ok) return { linked, revision: null };
      return { linked, revision: await bumpGroupRevision(tx, row.link.groupId) };
    });
    if (!result.linked.ok) {
      const errors = {
        MEMBER_NOT_FOUND: 'errors.not_found',
        MEMBER_ALREADY_LINKED: 'errors.member_already_linked',
        USER_ALREADY_LINKED_IN_GROUP: 'errors.user_already_linked_in_group',
        NAME_CONFLICT: 'errors.member_name_taken',
      } as const;
      return c.json({ ok: false, error: errors[result.linked.code] }, 409);
    }
    scheduleGroupEvent(c, row.link.groupId, {
      revision: result.revision!,
      type: 'member.changed',
      entityId: member.id,
      actorId: session.user.id,
    });
    return c.json({ ok: true, redirectTo: `/groups/${row.link.groupId}` });
  }

  await createShareSession(c, row.link.id);
  return c.json({ ok: true, redirectTo: `/groups/${row.link.groupId}` });
});

groupRoutes.post('/groups/:groupId/invitations', async (c) => {
  const groupId = c.req.param('groupId');
  const parsed = inviteMemberSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ ok: false, error: 'errors.invalid_input' }, 400);
  const access = await requireGroupAccess(c, groupId, 'MANAGE_SHARES');
  if (access.kind !== 'user') return c.json({ ok: false, error: 'errors.forbidden' }, 403);
  if (parsed.data.assignedRole === 'MANAGER' && access.role !== 'OWNER') {
    return c.json({ ok: false, error: 'errors.forbidden' }, 403);
  }
  const [target] = await c.var.db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.username}) = ${parsed.data.username}`)
    .limit(1);
  if (!target) return c.json({ ok: false, error: 'errors.user_not_found' }, 404);
  if (target.id === access.userId)
    return c.json({ ok: false, error: 'errors.cannot_invite_self' }, 409);
  const [member] = await c.var.db
    .select({ linkedUserId: members.linkedUserId })
    .from(members)
    .where(and(eq(members.id, parsed.data.memberId), eq(members.groupId, groupId)))
    .limit(1);
  if (!member) return c.json({ ok: false, error: 'errors.not_found' }, 404);
  if (member.linkedUserId) return c.json({ ok: false, error: 'errors.member_already_linked' }, 409);
  const [bound] = await c.var.db
    .select({ id: members.id })
    .from(members)
    .where(and(eq(members.groupId, groupId), eq(members.linkedUserId, target.id)))
    .limit(1);
  if (bound) return c.json({ ok: false, error: 'errors.user_already_linked_in_group' }, 409);

  const invitationId = createId();
  try {
    await c.var.db.insert(groupInvitations).values({
      id: invitationId,
      groupId,
      memberId: parsed.data.memberId,
      invitedUserId: target.id,
      invitedById: access.userId,
      assignedRole: parsed.data.assignedRole,
      message: parsed.data.message || null,
    });
  } catch (error) {
    if (uniqueError(error)) return c.json({ ok: false, error: 'errors.invitation_exists' }, 409);
    throw error;
  }
  return c.json({ ok: true, invitationId }, 201);
});

groupRoutes.delete('/groups/:groupId/invitations/:invitationId', async (c) => {
  const groupId = c.req.param('groupId');
  await requireGroupAccess(c, groupId, 'MANAGE_SHARES');
  const updated = await c.var.db
    .update(groupInvitations)
    .set({ status: 'CANCELED', respondedAt: new Date() })
    .where(
      and(
        eq(groupInvitations.id, c.req.param('invitationId')),
        eq(groupInvitations.groupId, groupId),
        eq(groupInvitations.status, 'PENDING'),
      ),
    )
    .returning({ id: groupInvitations.id });
  if (updated.length === 0) {
    return c.json({ ok: false, error: 'errors.invitation_not_pending' }, 409);
  }
  return c.json({ ok: true });
});

groupRoutes.post('/invitations/accept', async (c) => {
  const session = await requireUser(c);
  const parsed = idListSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ ok: false, error: 'errors.invalid_input' }, 400);
  const rows = await c.var.db
    .select({
      id: groupInvitations.id,
      groupId: groupInvitations.groupId,
      memberId: groupInvitations.memberId,
      assignedRole: groupInvitations.assignedRole,
    })
    .from(groupInvitations)
    .where(
      and(
        inArray(groupInvitations.id, parsed.data.ids),
        eq(groupInvitations.invitedUserId, session.user.id),
        eq(groupInvitations.status, 'PENDING'),
      ),
    );
  const accepted: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];

  for (const invitation of rows) {
    try {
      const result = await c.var.db.transaction(async (tx) => {
        const linked = await linkUserToMember(tx, {
          userId: session.user.id,
          memberId: invitation.memberId,
          grantedRole: invitation.assignedRole === 'OWNER' ? 'MEMBER' : invitation.assignedRole,
        });
        if (!linked.ok) return { linked, revision: null };
        await tx
          .update(groupInvitations)
          .set({ status: 'ACCEPTED', respondedAt: new Date() })
          .where(eq(groupInvitations.id, invitation.id));
        await tx
          .update(groupInvitations)
          .set({ status: 'CANCELED', respondedAt: new Date() })
          .where(
            and(
              eq(groupInvitations.memberId, invitation.memberId),
              eq(groupInvitations.status, 'PENDING'),
              ne(groupInvitations.id, invitation.id),
            ),
          );
        return { linked, revision: await bumpGroupRevision(tx, invitation.groupId) };
      });
      if (!result.linked.ok) {
        const errors = {
          MEMBER_NOT_FOUND: 'errors.not_found',
          MEMBER_ALREADY_LINKED: 'errors.member_already_linked',
          USER_ALREADY_LINKED_IN_GROUP: 'errors.user_already_linked_in_group',
          NAME_CONFLICT: 'errors.member_name_taken',
        } as const;
        failed.push({ id: invitation.id, error: errors[result.linked.code] });
        continue;
      }
      accepted.push(invitation.id);
      scheduleGroupEvent(c, invitation.groupId, {
        revision: result.revision!,
        type: 'member.changed',
        entityId: invitation.memberId,
        actorId: session.user.id,
      });
    } catch {
      failed.push({ id: invitation.id, error: 'errors.unknown' });
    }
  }
  const seen = new Set(rows.map((row) => row.id));
  for (const id of parsed.data.ids) {
    if (!seen.has(id)) failed.push({ id, error: 'errors.invitation_not_pending' });
  }
  return c.json({ ok: true, accepted, failed });
});

groupRoutes.post('/invitations/reject', async (c) => {
  const session = await requireUser(c);
  const parsed = idListSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ ok: false, error: 'errors.invalid_input' }, 400);
  const updated = await c.var.db
    .update(groupInvitations)
    .set({ status: 'REJECTED', respondedAt: new Date() })
    .where(
      and(
        inArray(groupInvitations.id, parsed.data.ids),
        eq(groupInvitations.invitedUserId, session.user.id),
        eq(groupInvitations.status, 'PENDING'),
      ),
    )
    .returning({ id: groupInvitations.id });
  return c.json({ ok: true, rejected: updated.map((row) => row.id) });
});

groupRoutes.post('/invitations/reject-all', async (c) => {
  const session = await requireUser(c);
  await c.var.db
    .update(groupInvitations)
    .set({ status: 'REJECTED', respondedAt: new Date() })
    .where(
      and(
        eq(groupInvitations.invitedUserId, session.user.id),
        eq(groupInvitations.status, 'PENDING'),
      ),
    );
  return c.json({ ok: true });
});

groupRoutes.get('/users/search', async (c) => {
  await requireUser(c);
  const query = c.req.query('q')?.trim().toLowerCase() ?? '';
  if (
    query.length < KEYFORGE_ALIAS_MIN_LENGTH ||
    query.length > KEYFORGE_ALIAS_MAX_LENGTH ||
    !KEYFORGE_ALIAS_PATTERN.test(query)
  ) {
    return c.json({ users: [] });
  }
  const rows = await c.var.db
    .select({ id: users.id, username: users.username, displayName: users.displayName })
    .from(users)
    .where(and(isNotNull(users.username), sql`lower(${users.username}) like ${`%${query}%`}`))
    .orderBy(asc(users.username))
    .limit(10);
  return c.json({ users: rows });
});
