import { GROUP_ROLE_RANK, usernameSchema, type GroupRole } from '@aaeasy/contracts';
import {
  allowedUsernames,
  authChallenges,
  expenseSplits,
  expenses,
  groupInvitations,
  groupMemberships,
  groups,
  members,
  passkeyCredentials,
  passwordCredentials,
  receipts,
  sessions,
  settlements,
  settlementEntries,
  shareLinks,
  users,
} from '@aaeasy/db/schema';
import { and, asc, count, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../app-env';
import { destroyCurrentSession, requireUser } from '../auth/session';
import { ApiError } from '../lib/errors';
import { bumpGroupRevision, scheduleGroupEvent } from '../realtime/events';
import { deleteReceiptObjects } from '../storage/receipts';

export const accountRoutes = new Hono<AppEnv>();

const displayNameSchema = z.object({ displayName: z.string().trim().min(1).max(64) });
const transferSchema = z.object({ newOwnerUserId: z.string().min(1) });
const mergeSchema = z
  .object({ sourceUserId: z.string().min(1), targetUserId: z.string().min(1) })
  .refine((value) => value.sourceUserId !== value.targetUserId, {
    message: 'errors.merge_same_user',
  });

async function requireSuperAdmin(c: Parameters<typeof requireUser>[0]) {
  const session = await requireUser(c);
  if (!session.user.isSuperAdmin) throw new ApiError('FORBIDDEN', 403);
  return session;
}

function initialAllowedUsernames(raw: string | undefined): string[] {
  return [
    ...new Set(
      (raw ?? '')
        .split(/[\s,;]+/u)
        .map((value) => value.trim().toLowerCase())
        .filter(
          (value) => value.length >= 3 && value.length <= 32 && /^[a-zA-Z0-9_.-]+$/u.test(value),
        ),
    ),
  ].sort();
}

function higherRole(left: GroupRole, right: GroupRole): GroupRole {
  return GROUP_ROLE_RANK[left] >= GROUP_ROLE_RANK[right] ? left : right;
}

accountRoutes.get('/account', async (c) => {
  const session = await requireUser(c);
  const [passkeys, passwords, ownedRows] = await Promise.all([
    c.var.db
      .select({
        id: passkeyCredentials.id,
        deviceLabel: passkeyCredentials.deviceLabel,
        transports: passkeyCredentials.transports,
        createdAt: passkeyCredentials.createdAt,
        lastUsedAt: passkeyCredentials.lastUsedAt,
      })
      .from(passkeyCredentials)
      .where(eq(passkeyCredentials.userId, session.user.id))
      .orderBy(desc(passkeyCredentials.createdAt)),
    c.var.db
      .select({
        id: passwordCredentials.id,
        label: passwordCredentials.label,
        createdAt: passwordCredentials.createdAt,
        lastUsedAt: passwordCredentials.lastUsedAt,
      })
      .from(passwordCredentials)
      .where(eq(passwordCredentials.userId, session.user.id))
      .orderBy(desc(passwordCredentials.createdAt)),
    c.var.db
      .select({ id: groups.id, name: groups.name })
      .from(groupMemberships)
      .innerJoin(groups, eq(groups.id, groupMemberships.groupId))
      .where(
        and(
          eq(groupMemberships.userId, session.user.id),
          eq(groupMemberships.role, 'OWNER'),
          isNull(groups.deletedAt),
        ),
      )
      .orderBy(asc(groupMemberships.joinedAt)),
  ]);
  const ownedIds = ownedRows.map((group) => group.id);
  const ownedCounts =
    ownedIds.length === 0
      ? []
      : await c.var.db
          .select({ groupId: members.groupId, total: count() })
          .from(members)
          .where(inArray(members.groupId, ownedIds))
          .groupBy(members.groupId);
  const countByGroup = new Map(ownedCounts.map((row) => [row.groupId, row.total]));

  let allLedgers: Array<{
    id: string;
    name: string;
    defaultCurrency: string;
    createdAt: string;
    deletedAt: string | null;
    memberCount: number;
  }> = [];
  if (session.user.isSuperAdmin) {
    const ledgerRows = await c.var.db
      .select({
        id: groups.id,
        name: groups.name,
        defaultCurrency: groups.defaultCurrency,
        createdAt: groups.createdAt,
        deletedAt: groups.deletedAt,
      })
      .from(groups)
      .orderBy(asc(groups.deletedAt), desc(groups.createdAt));
    const counts = await c.var.db
      .select({ groupId: members.groupId, total: count() })
      .from(members)
      .groupBy(members.groupId);
    const allCounts = new Map(counts.map((row) => [row.groupId, row.total]));
    allLedgers = ledgerRows.map((group) => ({
      ...group,
      createdAt: group.createdAt.toISOString(),
      deletedAt: group.deletedAt?.toISOString() ?? null,
      memberCount: allCounts.get(group.id) ?? 0,
    }));
  }

  return c.json({
    user: session.user,
    session: { userAgent: session.userAgent },
    credentials: [
      ...passkeys.map((credential) => ({
        id: credential.id,
        kind: 'passkey' as const,
        label: credential.deviceLabel,
        transports: credential.transports ?? [],
        createdAt: credential.createdAt.toISOString(),
        lastUsedAt: credential.lastUsedAt?.toISOString() ?? null,
      })),
      ...passwords.map((credential) => ({
        id: credential.id,
        kind: 'password' as const,
        label: credential.label,
        transports: [],
        createdAt: credential.createdAt.toISOString(),
        lastUsedAt: credential.lastUsedAt?.toISOString() ?? null,
      })),
    ],
    ownedGroups: ownedRows.map((group) => ({
      ...group,
      memberCount: countByGroup.get(group.id) ?? 0,
    })),
    allLedgers,
  });
});

accountRoutes.patch('/account/profile', async (c) => {
  const session = await requireUser(c);
  const parsed = displayNameSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ ok: false, fieldErrors: { displayName: 'errors.display_name_required' } }, 400);
  }
  const displayName = parsed.data.displayName;
  const [taken] = await c.var.db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        ne(users.id, session.user.id),
        sql`lower(${users.displayName}) = ${displayName.toLowerCase()}`,
      ),
    )
    .limit(1);
  if (taken) {
    return c.json({ ok: false, fieldErrors: { displayName: 'errors.display_name_taken' } }, 409);
  }
  const linked = await c.var.db
    .select({ id: members.id, groupId: members.groupId })
    .from(members)
    .where(eq(members.linkedUserId, session.user.id));
  for (const member of linked) {
    const [conflict] = await c.var.db
      .select({ id: members.id })
      .from(members)
      .where(
        and(
          eq(members.groupId, member.groupId),
          ne(members.id, member.id),
          sql`lower(${members.displayName}) = ${displayName.slice(0, 40).toLowerCase()}`,
        ),
      )
      .limit(1);
    if (conflict) {
      return c.json({ ok: false, fieldErrors: { displayName: 'errors.member_name_taken' } }, 409);
    }
  }
  const groupIds = [...new Set(linked.map((member) => member.groupId))];
  const revisions = await c.var.db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ displayName, updatedAt: new Date() })
      .where(eq(users.id, session.user.id));
    await tx
      .update(members)
      .set({ displayName: displayName.slice(0, 40) })
      .where(eq(members.linkedUserId, session.user.id));
    const result = new Map<string, string>();
    for (const groupId of groupIds) result.set(groupId, await bumpGroupRevision(tx, groupId));
    return result;
  });
  for (const [groupId, revision] of revisions) {
    scheduleGroupEvent(c, groupId, {
      revision,
      type: 'member.changed',
      actorId: session.user.id,
    });
  }
  return c.json({ ok: true });
});

accountRoutes.put('/groups/:groupId/ownership', async (c) => {
  const session = await requireUser(c);
  const groupId = c.req.param('groupId');
  const parsed = transferSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success || parsed.data.newOwnerUserId === session.user.id) {
    return c.json({ ok: false, error: 'errors.invalid_input' }, 400);
  }
  const [mine] = await c.var.db
    .select({ role: groupMemberships.role })
    .from(groupMemberships)
    .where(and(eq(groupMemberships.userId, session.user.id), eq(groupMemberships.groupId, groupId)))
    .limit(1);
  if (mine?.role !== 'OWNER') return c.json({ ok: false, error: 'errors.forbidden' }, 403);
  const [target] = await c.var.db
    .select({ role: groupMemberships.role })
    .from(groupMemberships)
    .where(
      and(
        eq(groupMemberships.userId, parsed.data.newOwnerUserId),
        eq(groupMemberships.groupId, groupId),
      ),
    )
    .limit(1);
  if (!target) return c.json({ ok: false, error: 'errors.not_found' }, 404);
  const [targetMember] = await c.var.db
    .select({ id: members.id })
    .from(members)
    .where(and(eq(members.groupId, groupId), eq(members.linkedUserId, parsed.data.newOwnerUserId)))
    .limit(1);
  if (!targetMember) return c.json({ ok: false, error: 'errors.target_not_linked' }, 409);
  const revision = await c.var.db.transaction(async (tx) => {
    await tx
      .update(groupMemberships)
      .set({ role: 'OWNER' })
      .where(
        and(
          eq(groupMemberships.userId, parsed.data.newOwnerUserId),
          eq(groupMemberships.groupId, groupId),
        ),
      );
    await tx
      .update(groupMemberships)
      .set({ role: 'MANAGER' })
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

accountRoutes.delete('/account', async (c) => {
  const session = await requireUser(c);
  const owned = await c.var.db
    .select({ groupId: groupMemberships.groupId })
    .from(groupMemberships)
    .where(and(eq(groupMemberships.userId, session.user.id), eq(groupMemberships.role, 'OWNER')));
  const ownedGroupIds = owned.map((ownedGroup) => ownedGroup.groupId);
  const storedReceipts =
    ownedGroupIds.length === 0
      ? []
      : await c.var.db
          .select({ objectKey: receipts.objectKey })
          .from(receipts)
          .innerJoin(expenses, eq(expenses.id, receipts.expenseId))
          .where(inArray(expenses.groupId, ownedGroupIds));

  await c.var.db.transaction(async (tx) => {
    for (const ownedGroup of owned) {
      const groupExpenseIds = tx
        .select({ id: expenses.id })
        .from(expenses)
        .where(eq(expenses.groupId, ownedGroup.groupId));
      await tx.delete(expenseSplits).where(inArray(expenseSplits.expenseId, groupExpenseIds));
      await tx.delete(settlementEntries).where(eq(settlementEntries.groupId, ownedGroup.groupId));
      await tx.delete(expenses).where(eq(expenses.groupId, ownedGroup.groupId));
      await tx.delete(members).where(eq(members.groupId, ownedGroup.groupId));
      await tx.delete(groups).where(eq(groups.id, ownedGroup.groupId));
    }
    await tx.delete(users).where(eq(users.id, session.user.id));
  });
  if (storedReceipts.length > 0) {
    c.executionCtx.waitUntil(
      deleteReceiptObjects(
        c.env.RECEIPTS,
        storedReceipts.map((receipt) => receipt.objectKey),
      ).catch((error) => console.error('receipt cleanup failed', error)),
    );
  }
  await destroyCurrentSession(c);
  return c.json({ ok: true });
});

accountRoutes.get('/admin/usernames', async (c) => {
  await requireSuperAdmin(c);
  const rows = await c.var.db
    .select({ username: allowedUsernames.username })
    .from(allowedUsernames)
    .orderBy(asc(allowedUsernames.username));
  return c.json({
    usernames: rows.map((row) => row.username),
    initialUsernames: initialAllowedUsernames(c.env.INITIAL_ALLOWED_USERNAMES),
  });
});

accountRoutes.put('/admin/usernames/:username', async (c) => {
  const session = await requireSuperAdmin(c);
  const parsed = usernameSchema.safeParse(c.req.param('username'));
  if (!parsed.success) return c.json({ ok: false, error: 'errors.invalid_input' }, 400);
  const username = parsed.data.toLowerCase();
  await c.var.db
    .insert(allowedUsernames)
    .values({ username, createdById: session.user.id })
    .onConflictDoNothing();
  return c.json({ ok: true });
});

accountRoutes.delete('/admin/usernames/:username', async (c) => {
  await requireSuperAdmin(c);
  const parsed = usernameSchema.safeParse(c.req.param('username'));
  if (!parsed.success) return c.json({ ok: false, error: 'errors.invalid_input' }, 400);
  await c.var.db
    .delete(allowedUsernames)
    .where(eq(allowedUsernames.username, parsed.data.toLowerCase()));
  return c.json({ ok: true });
});

accountRoutes.get('/admin/users', async (c) => {
  const session = await requireSuperAdmin(c);
  const rows = await c.var.db
    .select({
      id: users.id,
      displayName: users.displayName,
      username: users.username,
      isSuperAdmin: users.isSuperAdmin,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(asc(users.createdAt));
  const [membershipCounts, passkeyCounts, passwordCounts] = await Promise.all([
    c.var.db
      .select({ userId: groupMemberships.userId, total: count() })
      .from(groupMemberships)
      .groupBy(groupMemberships.userId),
    c.var.db
      .select({ userId: passkeyCredentials.userId, total: count() })
      .from(passkeyCredentials)
      .groupBy(passkeyCredentials.userId),
    c.var.db
      .select({ userId: passwordCredentials.userId, total: count() })
      .from(passwordCredentials)
      .groupBy(passwordCredentials.userId),
  ]);
  const groupsByUser = new Map(membershipCounts.map((row) => [row.userId, row.total]));
  const passkeysByUser = new Map(passkeyCounts.map((row) => [row.userId, row.total]));
  const passwordsByUser = new Map(passwordCounts.map((row) => [row.userId, row.total]));
  return c.json({
    currentUserId: session.user.id,
    users: rows.map((user) => ({
      ...user,
      createdAt: user.createdAt.toISOString(),
      groupCount: groupsByUser.get(user.id) ?? 0,
      loginCount: (passkeysByUser.get(user.id) ?? 0) + (passwordsByUser.get(user.id) ?? 0),
    })),
  });
});

accountRoutes.post('/admin/users/merge', async (c) => {
  const session = await requireSuperAdmin(c);
  const parsed = mergeSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ ok: false, error: 'errors.invalid_input' }, 400);
  const { sourceUserId, targetUserId } = parsed.data;
  if (sourceUserId === session.user.id) {
    return c.json({ ok: false, error: 'errors.merge_source_is_self' }, 409);
  }

  try {
    await c.var.db.transaction(async (tx) => {
      const [source] = await tx.select().from(users).where(eq(users.id, sourceUserId)).limit(1);
      const [target] = await tx.select().from(users).where(eq(users.id, targetUserId)).limit(1);
      if (!source || !target) throw new Error('errors.merge_user_not_found');
      if (source.isSuperAdmin) throw new Error('errors.merge_source_is_admin');

      const sourceMemberships = await tx
        .select()
        .from(groupMemberships)
        .where(eq(groupMemberships.userId, sourceUserId));
      const targetMemberships = await tx
        .select()
        .from(groupMemberships)
        .where(eq(groupMemberships.userId, targetUserId));
      const targetRoles = new Map(
        targetMemberships.map((membership) => [membership.groupId, membership.role]),
      );
      for (const membership of sourceMemberships) {
        const targetRole = targetRoles.get(membership.groupId);
        if (targetRole) {
          const merged = higherRole(membership.role, targetRole);
          if (merged !== targetRole) {
            await tx
              .update(groupMemberships)
              .set({ role: merged })
              .where(
                and(
                  eq(groupMemberships.userId, targetUserId),
                  eq(groupMemberships.groupId, membership.groupId),
                ),
              );
          }
          await tx
            .delete(groupMemberships)
            .where(
              and(
                eq(groupMemberships.userId, sourceUserId),
                eq(groupMemberships.groupId, membership.groupId),
              ),
            );
        } else {
          await tx
            .update(groupMemberships)
            .set({ userId: targetUserId })
            .where(
              and(
                eq(groupMemberships.userId, sourceUserId),
                eq(groupMemberships.groupId, membership.groupId),
              ),
            );
        }
      }

      const sourceMembers = await tx
        .select({ id: members.id, groupId: members.groupId })
        .from(members)
        .where(eq(members.linkedUserId, sourceUserId));
      const targetMembers = await tx
        .select({ groupId: members.groupId })
        .from(members)
        .where(eq(members.linkedUserId, targetUserId));
      const occupiedGroups = new Set(targetMembers.map((member) => member.groupId));
      for (const member of sourceMembers) {
        await tx
          .update(members)
          .set({ linkedUserId: occupiedGroups.has(member.groupId) ? null : targetUserId })
          .where(eq(members.id, member.id));
        occupiedGroups.add(member.groupId);
      }

      const sourceInvites = await tx
        .select({
          id: groupInvitations.id,
          memberId: groupInvitations.memberId,
          status: groupInvitations.status,
        })
        .from(groupInvitations)
        .where(eq(groupInvitations.invitedUserId, sourceUserId));
      const targetPending = await tx
        .select({ memberId: groupInvitations.memberId })
        .from(groupInvitations)
        .where(
          and(
            eq(groupInvitations.invitedUserId, targetUserId),
            eq(groupInvitations.status, 'PENDING'),
          ),
        );
      const targetPendingMembers = new Set(targetPending.map((invitation) => invitation.memberId));
      for (const invitation of sourceInvites) {
        if (invitation.status === 'PENDING' && targetPendingMembers.has(invitation.memberId)) {
          await tx.delete(groupInvitations).where(eq(groupInvitations.id, invitation.id));
        } else {
          await tx
            .update(groupInvitations)
            .set({ invitedUserId: targetUserId })
            .where(eq(groupInvitations.id, invitation.id));
        }
      }

      await tx
        .update(passwordCredentials)
        .set({ userId: targetUserId })
        .where(eq(passwordCredentials.userId, sourceUserId));
      await tx
        .update(passkeyCredentials)
        .set({ userId: targetUserId })
        .where(eq(passkeyCredentials.userId, sourceUserId));
      await tx
        .update(sessions)
        .set({ userId: targetUserId })
        .where(eq(sessions.userId, sourceUserId));
      await tx
        .update(groupInvitations)
        .set({ invitedById: targetUserId })
        .where(eq(groupInvitations.invitedById, sourceUserId));
      await tx
        .update(groups)
        .set({ createdById: targetUserId })
        .where(eq(groups.createdById, sourceUserId));
      await tx
        .update(shareLinks)
        .set({ createdById: targetUserId })
        .where(eq(shareLinks.createdById, sourceUserId));
      await tx
        .update(expenses)
        .set({ createdByUserId: targetUserId })
        .where(eq(expenses.createdByUserId, sourceUserId));
      await tx
        .update(receipts)
        .set({ uploadedById: targetUserId })
        .where(eq(receipts.uploadedById, sourceUserId));
      await tx
        .update(settlements)
        .set({ createdById: targetUserId })
        .where(eq(settlements.createdById, sourceUserId));
      await tx
        .update(settlementEntries)
        .set({ createdById: targetUserId })
        .where(eq(settlementEntries.createdById, sourceUserId));
      await tx.delete(authChallenges).where(eq(authChallenges.userId, sourceUserId));
      await tx.delete(users).where(eq(users.id, sourceUserId));
    });
  } catch (error) {
    const code =
      error instanceof Error && error.message.startsWith('errors.')
        ? error.message
        : 'errors.merge_failed';
    return c.json({ ok: false, error: code }, 409);
  }
  return c.json({ ok: true });
});

accountRoutes.post('/admin/promote/:secret', async (c) => {
  const session = await requireUser(c);
  if (!c.env.ADMIN_SECRET || c.req.param('secret') !== c.env.ADMIN_SECRET) {
    throw new ApiError('NOT_FOUND', 404);
  }
  await c.var.db
    .update(users)
    .set({ isSuperAdmin: true, updatedAt: new Date() })
    .where(eq(users.id, session.user.id));
  return c.json({ ok: true });
});
