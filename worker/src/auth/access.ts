import type { GroupRole, ShareScope } from '@aaeasy/contracts';
import { groupMemberships, groups, members } from '@aaeasy/db/schema';
import { and, eq } from 'drizzle-orm';
import type { Context } from 'hono';
import type { AppEnv } from '../app-env';
import { ApiError } from '../lib/errors';
import { getCurrentSession, getCurrentShareSession } from './session';

export type GroupAction =
  | 'READ_GROUP'
  | 'WRITE_EXPENSE'
  | 'MANAGE_MEMBERS'
  | 'MANAGE_SHARES'
  | 'SETTLE'
  | 'DELETE_GROUP';

export type GroupAccess =
  | {
      kind: 'user';
      userId: string;
      role: GroupRole;
      groupId: string;
      linkedMemberId: string | null;
      bypass: 'superadmin' | null;
    }
  | {
      kind: 'share';
      shareLinkId: string;
      scope: ShareScope;
      groupId: string;
      boundMemberId: string | null;
    };

export function isAllowed(access: GroupAccess, action: GroupAction): boolean {
  if (access.kind === 'user') {
    if (action === 'READ_GROUP') return true;
    if (action === 'WRITE_EXPENSE') {
      return (
        access.role === 'OWNER' ||
        access.role === 'MANAGER' ||
        (access.role === 'MEMBER' && access.linkedMemberId !== null)
      );
    }
    if (action === 'DELETE_GROUP') return access.role === 'OWNER';
    return access.role === 'OWNER' || access.role === 'MANAGER';
  }

  if (action === 'READ_GROUP') return true;
  if (action === 'WRITE_EXPENSE') {
    return access.scope === 'WRITE';
  }
  return false;
}

export async function requireGroupAccess(
  c: Context<AppEnv>,
  groupId: string,
  action: GroupAction,
): Promise<GroupAccess> {
  const [group] = await c.var.db
    .select({ id: groups.id, deletedAt: groups.deletedAt })
    .from(groups)
    .where(eq(groups.id, groupId))
    .limit(1);
  if (!group) throw new ApiError('NOT_FOUND', 404);

  const session = await getCurrentSession(c);
  if (session) {
    const [membership] = await c.var.db
      .select({ role: groupMemberships.role })
      .from(groupMemberships)
      .where(
        and(eq(groupMemberships.userId, session.user.id), eq(groupMemberships.groupId, groupId)),
      )
      .limit(1);
    if (membership) {
      if (group.deletedAt) throw new ApiError('NOT_FOUND', 404);
      const [linked] = await c.var.db
        .select({ id: members.id })
        .from(members)
        .where(and(eq(members.groupId, groupId), eq(members.linkedUserId, session.user.id)))
        .limit(1);
      const access: GroupAccess = {
        kind: 'user',
        userId: session.user.id,
        role: membership.role,
        groupId,
        linkedMemberId: linked?.id ?? null,
        bypass: null,
      };
      if (!isAllowed(access, action)) throw new ApiError('FORBIDDEN', 403);
      return access;
    }

    if (session.user.isSuperAdmin) {
      const access: GroupAccess = {
        kind: 'user',
        userId: session.user.id,
        role: 'OWNER',
        groupId,
        linkedMemberId: null,
        bypass: 'superadmin',
      };
      if (!isAllowed(access, action)) throw new ApiError('FORBIDDEN', 403);
      return access;
    }
  }

  if (group.deletedAt) throw new ApiError('NOT_FOUND', 404);
  const share = await getCurrentShareSession(c);
  if (share?.groupId === groupId) {
    const access: GroupAccess = { kind: 'share', ...share };
    if (!isAllowed(access, action)) throw new ApiError('FORBIDDEN', 403);
    return access;
  }

  throw new ApiError(session ? 'FORBIDDEN' : 'UNAUTHORIZED', session ? 403 : 401);
}
