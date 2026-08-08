import { inviteMemberSchema } from '@aaeasy/contracts';
import { groupInvitations, members, users } from '@aaeasy/db/schema';
import { createId } from '@paralleldrive/cuid2';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../app-env';
import { requireGroupAccess } from '../auth/access';
import { linkUserToMember } from '../auth/claim';
import { requireUser } from '../auth/session';
import { auditActor, userActor, writeAudit } from '../lib/audit';
import { isUniqueViolation } from '../lib/pg-errors';
import { bumpGroupRevision, scheduleGroupEvent } from '../realtime/events';

export const invitationRoutes = new Hono<AppEnv>();

const idListSchema = z.object({ ids: z.array(z.string().min(1)).min(1).max(100) });

const LINK_ERRORS = {
  MEMBER_NOT_FOUND: 'errors.not_found',
  MEMBER_ALREADY_LINKED: 'errors.member_already_linked',
  USER_ALREADY_LINKED_IN_GROUP: 'errors.user_already_linked_in_group',
  NAME_CONFLICT: 'errors.member_name_taken',
} as const;

invitationRoutes.post('/groups/:groupId/invitations', async (c) => {
  const groupId = c.req.param('groupId');
  const parsed = inviteMemberSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ ok: false, error: 'errors.invalid_input' }, 400);
  const { access } = await requireGroupAccess(c, groupId, 'MANAGE_SHARES');
  if (access.kind !== 'user') return c.json({ ok: false, error: 'errors.forbidden' }, 403);
  if (parsed.data.assignedRole === 'MANAGER' && access.role !== 'OWNER') {
    return c.json({ ok: false, error: 'errors.forbidden' }, 403);
  }
  const [[target], [member]] = await Promise.all([
    c.var.db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.username}) = ${parsed.data.username}`)
      .limit(1),
    c.var.db
      .select({ linkedUserId: members.linkedUserId })
      .from(members)
      .where(and(eq(members.id, parsed.data.memberId), eq(members.groupId, groupId)))
      .limit(1),
  ]);
  if (!target) return c.json({ ok: false, error: 'errors.user_not_found' }, 404);
  if (target.id === access.userId) {
    return c.json({ ok: false, error: 'errors.cannot_invite_self' }, 409);
  }
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
    await c.var.db.transaction(async (tx) => {
      await tx.insert(groupInvitations).values({
        id: invitationId,
        groupId,
        memberId: parsed.data.memberId,
        invitedUserId: target.id,
        invitedById: access.userId,
        assignedRole: parsed.data.assignedRole,
        message: parsed.data.message || null,
      });
      await writeAudit(tx, {
        groupId,
        actor: auditActor(access),
        action: 'INVITATION_CREATE',
        targetType: 'Invitation',
        targetId: invitationId,
        diff: {
          invitedUserId: target.id,
          memberId: parsed.data.memberId,
          assignedRole: parsed.data.assignedRole,
        },
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return c.json({ ok: false, error: 'errors.invitation_exists' }, 409);
    }
    throw error;
  }
  return c.json({ ok: true, invitationId }, 201);
});

invitationRoutes.delete('/groups/:groupId/invitations/:invitationId', async (c) => {
  const groupId = c.req.param('groupId');
  const invitationId = c.req.param('invitationId');
  const { access } = await requireGroupAccess(c, groupId, 'MANAGE_SHARES');
  const canceled = await c.var.db.transaction(async (tx) => {
    const updated = await tx
      .update(groupInvitations)
      .set({ status: 'CANCELED', respondedAt: new Date() })
      .where(
        and(
          eq(groupInvitations.id, invitationId),
          eq(groupInvitations.groupId, groupId),
          eq(groupInvitations.status, 'PENDING'),
        ),
      )
      .returning({ id: groupInvitations.id });
    if (updated.length === 0) return false;
    await writeAudit(tx, {
      groupId,
      actor: auditActor(access),
      action: 'INVITATION_CANCEL',
      targetType: 'Invitation',
      targetId: invitationId,
      diff: { status: { before: 'PENDING', after: 'CANCELED' } },
    });
    return true;
  });
  if (!canceled) {
    return c.json({ ok: false, error: 'errors.invitation_not_pending' }, 409);
  }
  return c.json({ ok: true });
});

invitationRoutes.post('/invitations/accept', async (c) => {
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
        await writeAudit(tx, {
          groupId: invitation.groupId,
          actor: userActor(session.user.id),
          action: 'INVITATION_ACCEPT',
          targetType: 'Invitation',
          targetId: invitation.id,
          diff: { memberId: invitation.memberId, grantedRole: invitation.assignedRole },
        });
        return { linked, revision: await bumpGroupRevision(tx, invitation.groupId) };
      });
      if (!result.linked.ok) {
        failed.push({ id: invitation.id, error: LINK_ERRORS[result.linked.code] });
        continue;
      }
      accepted.push(invitation.id);
      scheduleGroupEvent(c, invitation.groupId, {
        revision: result.revision!,
        type: 'member.changed',
        entityId: invitation.memberId,
        actorId: session.user.id,
      });
    } catch (error) {
      // linkUserToMember returns typed failures, so reaching here means an
      // unexpected fault; keep the batch going but do not lose the cause.
      console.error(error);
      failed.push({ id: invitation.id, error: 'errors.unknown' });
    }
  }
  const seen = new Set(rows.map((row) => row.id));
  for (const id of parsed.data.ids) {
    if (!seen.has(id)) failed.push({ id, error: 'errors.invitation_not_pending' });
  }
  return c.json({ ok: true, accepted, failed });
});

invitationRoutes.post('/invitations/reject', async (c) => {
  const session = await requireUser(c);
  const parsed = idListSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ ok: false, error: 'errors.invalid_input' }, 400);
  const rejected = await rejectInvitations(c, session.user.id, parsed.data.ids);
  return c.json({ ok: true, rejected });
});

invitationRoutes.post('/invitations/reject-all', async (c) => {
  const session = await requireUser(c);
  await rejectInvitations(c, session.user.id, null);
  return c.json({ ok: true });
});

async function rejectInvitations(
  c: Context<AppEnv>,
  userId: string,
  ids: string[] | null,
): Promise<string[]> {
  return c.var.db.transaction(async (tx) => {
    const updated = await tx
      .update(groupInvitations)
      .set({ status: 'REJECTED', respondedAt: new Date() })
      .where(
        and(
          ids ? inArray(groupInvitations.id, ids) : undefined,
          eq(groupInvitations.invitedUserId, userId),
          eq(groupInvitations.status, 'PENDING'),
        ),
      )
      .returning({ id: groupInvitations.id, groupId: groupInvitations.groupId });
    for (const row of updated) {
      await writeAudit(tx, {
        groupId: row.groupId,
        actor: userActor(userId),
        action: 'INVITATION_REJECT',
        targetType: 'Invitation',
        targetId: row.id,
        diff: { status: { before: 'PENDING', after: 'REJECTED' } },
      });
    }
    return updated.map((row) => row.id);
  });
}
