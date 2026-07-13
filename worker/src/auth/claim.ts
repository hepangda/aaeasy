import { GROUP_ROLE_RANK, type GroupRole } from '@aaeasy/contracts';
import type { Database } from '@aaeasy/db';
import { groupMemberships, members, shareLinks, shareSessions, users } from '@aaeasy/db/schema';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import type { Context } from 'hono';
import { deleteCookie, getCookie } from 'hono/cookie';
import type { AppEnv } from '../app-env';
import { sha256 } from '../lib/crypto';
import { SHARE_SESSION_COOKIE } from './session';

type AssignableRole = Exclude<GroupRole, 'OWNER'>;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export type LinkUserToMemberResult =
  | { ok: true; groupId: string }
  | {
      ok: false;
      code:
        | 'MEMBER_NOT_FOUND'
        | 'MEMBER_ALREADY_LINKED'
        | 'USER_ALREADY_LINKED_IN_GROUP'
        | 'NAME_CONFLICT';
    };

export async function linkUserToMember(
  db: Database | Transaction,
  input: { userId: string; memberId: string; grantedRole: AssignableRole },
): Promise<LinkUserToMemberResult> {
  const [member] = await db
    .select({ id: members.id, linkedUserId: members.linkedUserId, groupId: members.groupId })
    .from(members)
    .where(eq(members.id, input.memberId))
    .limit(1);
  if (!member) return { ok: false, code: 'MEMBER_NOT_FOUND' };
  if (member.linkedUserId && member.linkedUserId !== input.userId) {
    return { ok: false, code: 'MEMBER_ALREADY_LINKED' };
  }

  if (member.linkedUserId !== input.userId) {
    const [conflicting] = await db
      .select({ id: members.id })
      .from(members)
      .where(and(eq(members.groupId, member.groupId), eq(members.linkedUserId, input.userId)))
      .limit(1);
    if (conflicting && conflicting.id !== member.id) {
      return { ok: false, code: 'USER_ALREADY_LINKED_IN_GROUP' };
    }
  }

  const [account] = await db
    .select({ displayName: users.displayName })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);
  const nextMemberName = account?.displayName.slice(0, 40) ?? null;

  if (member.linkedUserId !== input.userId) {
    if (nextMemberName) {
      const [conflict] = await db
        .select({ id: members.id })
        .from(members)
        .where(
          and(
            eq(members.groupId, member.groupId),
            ne(members.id, member.id),
            sql`lower(${members.displayName}) = ${nextMemberName.toLowerCase()}`,
          ),
        )
        .limit(1);
      if (conflict) return { ok: false, code: 'NAME_CONFLICT' };
    }

    await db
      .update(members)
      .set({
        linkedUserId: input.userId,
        ...(nextMemberName ? { displayName: nextMemberName } : {}),
      })
      .where(eq(members.id, member.id));

    const activeLinks = await db
      .select({ id: shareLinks.id })
      .from(shareLinks)
      .where(and(eq(shareLinks.memberId, member.id), sql`${shareLinks.revokedAt} is null`));
    const linkIds = activeLinks.map((link) => link.id);
    if (linkIds.length > 0) {
      await db.delete(shareSessions).where(inArray(shareSessions.shareLinkId, linkIds));
      await db
        .update(shareLinks)
        .set({ revokedAt: new Date() })
        .where(inArray(shareLinks.id, linkIds));
    }
  }

  const [membership] = await db
    .select({ role: groupMemberships.role })
    .from(groupMemberships)
    .where(
      and(eq(groupMemberships.userId, input.userId), eq(groupMemberships.groupId, member.groupId)),
    )
    .limit(1);
  if (!membership) {
    await db.insert(groupMemberships).values({
      userId: input.userId,
      groupId: member.groupId,
      role: input.grantedRole,
    });
  } else if (GROUP_ROLE_RANK[input.grantedRole] > GROUP_ROLE_RANK[membership.role]) {
    await db
      .update(groupMemberships)
      .set({ role: input.grantedRole })
      .where(
        and(
          eq(groupMemberships.userId, input.userId),
          eq(groupMemberships.groupId, member.groupId),
        ),
      );
  }

  return { ok: true, groupId: member.groupId };
}

export async function claimPendingShareLink(
  c: Context<AppEnv>,
  userId: string,
): Promise<string | null> {
  const token = getCookie(c, SHARE_SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = await sha256(token);
  const [row] = await c.var.db
    .select({ session: shareSessions, link: shareLinks })
    .from(shareSessions)
    .innerJoin(shareLinks, eq(shareLinks.id, shareSessions.shareLinkId))
    .where(eq(shareSessions.tokenHash, tokenHash))
    .limit(1);
  if (
    !row ||
    row.session.expiresAt <= new Date() ||
    row.link.revokedAt ||
    (row.link.expiresAt && row.link.expiresAt <= new Date()) ||
    !row.link.memberId
  ) {
    return null;
  }

  const grantedRole = (row.link.assignedRole as AssignableRole | null) ?? 'MEMBER';
  const result = await c.var.db.transaction((tx) =>
    linkUserToMember(tx, { userId, memberId: row.link.memberId!, grantedRole }),
  );
  await c.var.db.delete(shareSessions).where(eq(shareSessions.tokenHash, tokenHash));
  deleteCookie(c, SHARE_SESSION_COOKIE, { path: '/' });
  return result.ok ? result.groupId : null;
}
