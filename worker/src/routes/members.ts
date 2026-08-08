import { createMemberSchema, updateMemberSchema } from '@aaeasy/contracts';
import {
  expenseSplits,
  expenses,
  groupMemberships,
  members,
  settlementEntries,
} from '@aaeasy/db/schema';
import { createId } from '@paralleldrive/cuid2';
import { and, count, eq, inArray, isNotNull, isNull, max, ne, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppEnv } from '../app-env';
import { actorId, requireGroupAccess } from '../auth/access';
import { auditActor, writeAudit } from '../lib/audit';
import { bumpGroupRevision, scheduleGroupEvent } from '../realtime/events';

export const memberRoutes = new Hono<AppEnv>();

memberRoutes.post('/groups/:groupId/members', async (c) => {
  const groupId = c.req.param('groupId');
  const parsed = createMemberSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ ok: false, error: 'errors.invalid_input' }, 400);
  const { access } = await requireGroupAccess(c, groupId, 'MANAGE_MEMBERS');
  const [existing] = await c.var.db
    .select({
      conflictId: sql<
        string | null
      >`max(${members.id}) filter (where lower(${members.displayName}) = ${parsed.data.displayName.toLowerCase()})`,
      highestSortOrder: max(members.sortOrder),
    })
    .from(members)
    .where(eq(members.groupId, groupId));
  if (existing?.conflictId) return c.json({ ok: false, error: 'errors.member_name_taken' }, 409);

  const memberId = createId();
  const revision = await c.var.db.transaction(async (tx) => {
    await tx.insert(members).values({
      id: memberId,
      groupId,
      displayName: parsed.data.displayName,
      sortOrder: (existing?.highestSortOrder ?? -1) + 1,
    });
    await writeAudit(tx, {
      groupId,
      actor: auditActor(access),
      action: 'MEMBER_ADD',
      targetType: 'Member',
      targetId: memberId,
      diff: { displayName: { before: null, after: parsed.data.displayName } },
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

memberRoutes.patch('/groups/:groupId/members/:memberId', async (c) => {
  const groupId = c.req.param('groupId');
  const memberId = c.req.param('memberId');
  const parsed = updateMemberSchema
    .pick({ displayName: true })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success || !parsed.data.displayName) {
    return c.json({ ok: false, error: 'errors.invalid_input' }, 400);
  }
  const displayName = parsed.data.displayName;
  const { access } = await requireGroupAccess(c, groupId, 'MANAGE_MEMBERS');
  const [[current], [conflict]] = await Promise.all([
    c.var.db
      .select({ displayName: members.displayName })
      .from(members)
      .where(and(eq(members.id, memberId), eq(members.groupId, groupId)))
      .limit(1),
    c.var.db
      .select({ id: members.id })
      .from(members)
      .where(
        and(
          eq(members.groupId, groupId),
          ne(members.id, memberId),
          sql`lower(${members.displayName}) = ${displayName.toLowerCase()}`,
        ),
      )
      .limit(1),
  ]);
  if (!current) return c.json({ ok: false, error: 'errors.not_found' }, 404);
  if (conflict) return c.json({ ok: false, error: 'errors.member_name_taken' }, 409);
  const revision = await c.var.db.transaction(async (tx) => {
    const updated = await tx
      .update(members)
      .set({ displayName })
      .where(and(eq(members.id, memberId), eq(members.groupId, groupId)))
      .returning({ id: members.id });
    if (updated.length === 0) return null;
    await writeAudit(tx, {
      groupId,
      actor: auditActor(access),
      action: 'MEMBER_RENAME',
      targetType: 'Member',
      targetId: memberId,
      diff: { displayName: { before: current.displayName, after: displayName } },
    });
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

memberRoutes.delete('/groups/:groupId/members/:memberId', async (c) => {
  const groupId = c.req.param('groupId');
  const memberId = c.req.param('memberId');
  const { access } = await requireGroupAccess(c, groupId, 'MANAGE_MEMBERS');
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
      .returning({ displayName: members.displayName });
    if (deleted.length === 0) return null;
    await writeAudit(tx, {
      groupId,
      actor: auditActor(access),
      action: 'MEMBER_REMOVE',
      targetType: 'Member',
      targetId: memberId,
      diff: { displayName: { before: deleted[0]!.displayName, after: null } },
    });
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

memberRoutes.put('/groups/:groupId/members/:memberId/role', async (c) => {
  const groupId = c.req.param('groupId');
  const memberId = c.req.param('memberId');
  const parsed = updateMemberSchema
    .pick({ role: true })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success || !parsed.data.role) {
    return c.json({ ok: false, error: 'errors.invalid_input' }, 400);
  }
  const role = parsed.data.role;
  const { access } = await requireGroupAccess(c, groupId, 'DELETE_GROUP');
  const [member] = await c.var.db
    .select({ linkedUserId: members.linkedUserId, currentRole: groupMemberships.role })
    .from(members)
    .leftJoin(
      groupMemberships,
      and(
        eq(groupMemberships.userId, members.linkedUserId),
        eq(groupMemberships.groupId, members.groupId),
      ),
    )
    .where(and(eq(members.id, memberId), eq(members.groupId, groupId)))
    .limit(1);
  if (!member) return c.json({ ok: false, error: 'errors.not_found' }, 404);
  const linkedUserId = member.linkedUserId;
  if (!linkedUserId) return c.json({ ok: false, error: 'errors.target_not_linked' }, 409);
  if (member.currentRole === 'OWNER') return c.json({ ok: false, error: 'errors.forbidden' }, 403);

  const revision = await c.var.db.transaction(async (tx) => {
    await tx
      .insert(groupMemberships)
      .values({ userId: linkedUserId, groupId, role })
      .onConflictDoUpdate({
        target: [groupMemberships.userId, groupMemberships.groupId],
        set: { role },
      });
    await writeAudit(tx, {
      groupId,
      actor: auditActor(access),
      action: 'MEMBER_ROLE_CHANGE',
      targetType: 'Membership',
      targetId: linkedUserId,
      diff: { role: { before: member.currentRole ?? null, after: role }, memberId },
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

memberRoutes.delete('/groups/:groupId/members/:memberId/link', async (c) => {
  const groupId = c.req.param('groupId');
  const memberId = c.req.param('memberId');
  const { access } = await requireGroupAccess(c, groupId, 'MANAGE_MEMBERS');
  const [member] = await c.var.db
    .select({ linkedUserId: members.linkedUserId, currentRole: groupMemberships.role })
    .from(members)
    .leftJoin(
      groupMemberships,
      and(
        eq(groupMemberships.userId, members.linkedUserId),
        eq(groupMemberships.groupId, members.groupId),
      ),
    )
    .where(and(eq(members.id, memberId), eq(members.groupId, groupId)))
    .limit(1);
  if (!member) return c.json({ ok: false, error: 'errors.not_found' }, 404);
  const linkedUserId = member.linkedUserId;
  if (!linkedUserId) return c.json({ ok: true });
  if (member.currentRole === 'OWNER') return c.json({ ok: false, error: 'errors.forbidden' }, 403);

  const revision = await c.var.db.transaction(async (tx) => {
    await tx.update(members).set({ linkedUserId: null }).where(eq(members.id, memberId));
    await tx
      .delete(groupMemberships)
      .where(
        and(
          eq(groupMemberships.userId, linkedUserId),
          eq(groupMemberships.groupId, groupId),
          inArray(groupMemberships.role, ['MEMBER', 'MANAGER', 'VIEWER']),
        ),
      );
    await writeAudit(tx, {
      groupId,
      actor: auditActor(access),
      action: 'MEMBER_UNLINK',
      targetType: 'Member',
      targetId: memberId,
      diff: { linkedUserId: { before: linkedUserId, after: null } },
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
