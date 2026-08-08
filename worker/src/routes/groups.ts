import { createGroupSchema, renameGroupSchema } from '@aaeasy/contracts';
import {
  groupInvitations,
  groupMemberships,
  groups,
  members,
  settlements,
  shareLinks,
  users,
} from '@aaeasy/db/schema';
import { createId } from '@paralleldrive/cuid2';
import { and, asc, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppEnv } from '../app-env';
import { accessDto, actorId, isAllowed, requireGroupAccess } from '../auth/access';
import { requireUser } from '../auth/session';
import { userActor, writeAudit } from '../lib/audit';
import { fieldErrors } from '../lib/validation';
import { bumpGroupRevision, scheduleGroupEvent } from '../realtime/events';

export const groupRoutes = new Hono<AppEnv>();

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
  const [memberCounts, invitations] = await Promise.all([
    groupIds.length === 0
      ? []
      : c.var.db
          .select({ groupId: members.groupId, memberCount: count() })
          .from(members)
          .where(inArray(members.groupId, groupIds))
          .groupBy(members.groupId),
    c.var.db
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
      .orderBy(desc(groupInvitations.createdAt)),
  ]);
  const countByGroup = new Map(memberCounts.map((row) => [row.groupId, row.memberCount]));

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
    await writeAudit(tx, {
      groupId,
      actor: userActor(session.user.id),
      action: 'GROUP_CREATE',
      targetType: 'Group',
      targetId: groupId,
      diff: {
        name: parsed.data.name,
        defaultCurrency: parsed.data.defaultCurrency,
        memberCount: pending.length,
      },
    });
  });

  return c.json({ ok: true, groupId, unresolvedMention }, 201);
});

groupRoutes.get('/groups/:groupId', async (c) => {
  const groupId = c.req.param('groupId');
  const { access, group } = await requireGroupAccess(c, groupId, 'READ_GROUP');
  const canManage = isAllowed(access, 'MANAGE_MEMBERS');

  const [memberRows, memberships, linkRows, invitationRows, activeSettlement] = await Promise.all([
    c.var.db
      .select({
        id: members.id,
        displayName: members.displayName,
        linkedUserId: members.linkedUserId,
        linkedUsername: users.username,
        linkedUserPicture: users.picture,
        color: members.color,
        sortOrder: members.sortOrder,
        createdAt: members.createdAt,
      })
      .from(members)
      .leftJoin(users, eq(users.id, members.linkedUserId))
      .where(eq(members.groupId, groupId))
      .orderBy(asc(members.sortOrder), asc(members.createdAt)),
    c.var.db
      .select({ userId: groupMemberships.userId, role: groupMemberships.role })
      .from(groupMemberships)
      .where(eq(groupMemberships.groupId, groupId)),
    canManage
      ? c.var.db
          .select()
          .from(shareLinks)
          .where(eq(shareLinks.groupId, groupId))
          .orderBy(desc(shareLinks.createdAt))
      : [],
    canManage
      ? c.var.db
          .select({
            id: groupInvitations.id,
            memberId: groupInvitations.memberId,
            assignedRole: groupInvitations.assignedRole,
            createdAt: groupInvitations.createdAt,
            invitedUserId: groupInvitations.invitedUserId,
            invitedById: groupInvitations.invitedById,
            invitedUserDisplayName: users.displayName,
            invitedUserUsername: users.username,
          })
          .from(groupInvitations)
          .leftJoin(users, eq(users.id, groupInvitations.invitedUserId))
          .where(and(eq(groupInvitations.groupId, groupId), eq(groupInvitations.status, 'PENDING')))
          .orderBy(desc(groupInvitations.createdAt))
      : [],
    // The settlement that currently holds the ledger closed, if any. Reopened
    // ones stay in the table as history and must not be offered for reopening.
    c.var.db
      .select({ id: settlements.id })
      .from(settlements)
      .where(and(eq(settlements.groupId, groupId), isNull(settlements.reopenedAt)))
      .orderBy(desc(settlements.createdAt))
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ]);

  const roles = new Map(memberships.map((membership) => [membership.userId, membership.role]));
  const inviterIds = [
    ...new Set(invitationRows.flatMap((row) => (row.invitedById ? [row.invitedById] : []))),
  ];
  const inviters =
    inviterIds.length === 0
      ? []
      : await c.var.db
          .select({ id: users.id, displayName: users.displayName, username: users.username })
          .from(users)
          .where(inArray(users.id, inviterIds));
  const inviterById = new Map(inviters.map((user) => [user.id, user]));

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
      id: invitation.id,
      memberId: invitation.memberId,
      assignedRole: invitation.assignedRole,
      createdAt: invitation.createdAt.toISOString(),
      invitedUserId: invitation.invitedUserId,
      invitedById: invitation.invitedById,
      invitedUser: invitation.invitedUserDisplayName
        ? {
            id: invitation.invitedUserId,
            displayName: invitation.invitedUserDisplayName,
            username: invitation.invitedUserUsername,
          }
        : null,
      invitedBy: invitation.invitedById ? (inviterById.get(invitation.invitedById) ?? null) : null,
    })),
    activeSettlementId: activeSettlement?.id ?? null,
  });
});

groupRoutes.patch('/groups/:groupId', async (c) => {
  const groupId = c.req.param('groupId');
  const parsed = renameGroupSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ ok: false, error: 'errors.invalid_input' }, 400);
  const { access, group } = await requireGroupAccess(c, groupId, 'MANAGE_MEMBERS');
  const revision = await c.var.db.transaction(async (tx) => {
    await tx.update(groups).set({ name: parsed.data.name }).where(eq(groups.id, groupId));
    await writeAudit(tx, {
      groupId,
      actor: { type: access.kind === 'user' ? 'USER' : 'SHARE', id: actorId(access) },
      action: 'GROUP_RENAME',
      targetType: 'Group',
      targetId: groupId,
      diff: { name: { before: group.name, after: parsed.data.name } },
    });
    return bumpGroupRevision(tx, groupId);
  });
  scheduleGroupEvent(c, groupId, { revision, type: 'group.updated', actorId: actorId(access) });
  return c.json({ ok: true, revision });
});

groupRoutes.delete('/groups/:groupId', async (c) => {
  const groupId = c.req.param('groupId');
  const { access } = await requireGroupAccess(c, groupId, 'DELETE_GROUP');
  const deleted = await c.var.db.transaction(async (tx) => {
    const updated = await tx
      .update(groups)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(groups.id, groupId), isNull(groups.deletedAt)))
      .returning({ id: groups.id });
    if (updated.length === 0) return false;
    await writeAudit(tx, {
      groupId,
      actor: userActor(actorId(access)),
      action: 'GROUP_DELETE',
      targetType: 'Group',
      targetId: groupId,
    });
    return true;
  });
  if (!deleted) return c.json({ ok: false, error: 'errors.not_found' }, 404);
  return c.json({ ok: true });
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
    await writeAudit(tx, {
      groupId,
      actor: userActor(session.user.id),
      action: 'MEMBER_LEAVE',
      targetType: 'Membership',
      targetId: session.user.id,
      diff: { role: { before: membership.role, after: null } },
    });
    return bumpGroupRevision(tx, groupId);
  });
  scheduleGroupEvent(c, groupId, {
    revision,
    type: 'member.changed',
    actorId: session.user.id,
  });
  return c.json({ ok: true, revision });
});
