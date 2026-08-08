import { createShareLinkSchema } from '@aaeasy/contracts';
import { groups, members, shareLinks, shareSessions } from '@aaeasy/db/schema';
import { createId } from '@paralleldrive/cuid2';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../app-env';
import { requireGroupAccess } from '../auth/access';
import { linkUserToMember } from '../auth/claim';
import { createShareSession, getCurrentSession } from '../auth/session';
import { auditActor, userActor, writeAudit } from '../lib/audit';
import { generateToken, sha256 } from '../lib/crypto';
import { rateLimit } from '../lib/rate-limit';
import { getClientIp } from '../lib/request';
import { bumpGroupRevision, scheduleGroupEvent } from '../realtime/events';

export const shareLinkRoutes = new Hono<AppEnv>();

const unlockSchema = z.object({
  token: z.string().min(10).max(128),
  claimMemberId: z.string().min(1).optional(),
});

const LINK_ERRORS = {
  MEMBER_NOT_FOUND: 'errors.not_found',
  MEMBER_ALREADY_LINKED: 'errors.member_already_linked',
  USER_ALREADY_LINKED_IN_GROUP: 'errors.user_already_linked_in_group',
  NAME_CONFLICT: 'errors.member_name_taken',
} as const;

shareLinkRoutes.post('/groups/:groupId/share-links', async (c) => {
  const groupId = c.req.param('groupId');
  const parsed = createShareLinkSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ ok: false, error: 'errors.invalid_input' }, 400);
  const { access } = await requireGroupAccess(c, groupId, 'MANAGE_SHARES');
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
  const scope = parsed.data.memberId ? parsed.data.scope : 'READ';
  const assignedRole = parsed.data.memberId ? (parsed.data.assignedRole ?? 'MEMBER') : null;
  await c.var.db.transaction(async (tx) => {
    await tx.insert(shareLinks).values({
      id: linkId,
      groupId,
      tokenHash: await sha256(token),
      scope,
      assignedRole,
      memberId: parsed.data.memberId ?? null,
      expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
      label: parsed.data.label || defaultLabel,
      createdById: access.userId,
    });
    await writeAudit(tx, {
      groupId,
      actor: auditActor(access),
      action: 'SHARE_LINK_CREATE',
      targetType: 'ShareLink',
      targetId: linkId,
      diff: { scope, assignedRole, memberId: parsed.data.memberId ?? null },
    });
  });
  return c.json({ ok: true, id: linkId, token }, 201);
});

shareLinkRoutes.delete('/groups/:groupId/share-links/:shareLinkId', async (c) => {
  const groupId = c.req.param('groupId');
  const { access } = await requireGroupAccess(c, groupId, 'MANAGE_SHARES');
  const shareLinkId = c.req.param('shareLinkId');
  const revoked = await c.var.db.transaction(async (tx) => {
    const updated = await tx
      .update(shareLinks)
      .set({ revokedAt: new Date() })
      .where(and(eq(shareLinks.id, shareLinkId), eq(shareLinks.groupId, groupId)))
      .returning({ id: shareLinks.id });
    if (updated.length === 0) return false;
    await tx.delete(shareSessions).where(eq(shareSessions.shareLinkId, shareLinkId));
    await writeAudit(tx, {
      groupId,
      actor: auditActor(access),
      action: 'SHARE_LINK_REVOKE',
      targetType: 'ShareLink',
      targetId: shareLinkId,
    });
    return true;
  });
  if (!revoked) return c.json({ ok: false, error: 'errors.not_found' }, 404);
  return c.json({ ok: true });
});

shareLinkRoutes.post('/share/unlock', async (c) => {
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
      await writeAudit(tx, {
        groupId: row.link.groupId,
        actor: userActor(session.user.id),
        action: 'MEMBER_LINK',
        targetType: 'Member',
        targetId: member.id,
        diff: { via: 'share_link', shareLinkId: row.link.id, grantedRole },
      });
      return { linked, revision: await bumpGroupRevision(tx, row.link.groupId) };
    });
    if (!result.linked.ok) {
      return c.json({ ok: false, error: LINK_ERRORS[result.linked.code] }, 409);
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
