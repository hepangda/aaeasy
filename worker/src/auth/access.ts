import type { GroupAccessDto, GroupRole, ShareScope } from '@aaeasy/contracts';
import { groupMemberships, groups, members } from '@aaeasy/db/schema';
import type { GroupRow } from '@aaeasy/db/schema';
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

/**
 * What an authorized request already knows about the group.
 *
 * Every route used to re-select the group row that authorization had just
 * read. Returning it here removes one round trip per request — and over
 * Hyperdrive the round trip, not the query, is the cost.
 */
export interface GroupContext {
  access: GroupAccess;
  group: GroupRow;
}

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

/**
 * The group plus this user's standing in it, in a single query.
 *
 * `members` can be joined one-to-one because `members_groupId_linkedUserId_key`
 * guarantees at most one member row per user per group.
 */
async function loadGroupForUser(c: Context<AppEnv>, groupId: string, userId: string) {
  const [row] = await c.var.db
    .select({
      group: groups,
      role: groupMemberships.role,
      linkedMemberId: members.id,
    })
    .from(groups)
    .leftJoin(
      groupMemberships,
      and(eq(groupMemberships.groupId, groups.id), eq(groupMemberships.userId, userId)),
    )
    .leftJoin(members, and(eq(members.groupId, groups.id), eq(members.linkedUserId, userId)))
    .where(eq(groups.id, groupId))
    .limit(1);
  return row ?? null;
}

export async function requireGroupAccess(
  c: Context<AppEnv>,
  groupId: string,
  action: GroupAction,
): Promise<GroupContext> {
  const session = await getCurrentSession(c);

  if (session) {
    const row = await loadGroupForUser(c, groupId, session.user.id);
    if (!row) throw new ApiError('NOT_FOUND', 404);

    if (row.role) {
      if (row.group.deletedAt) throw new ApiError('NOT_FOUND', 404);
      const access: GroupAccess = {
        kind: 'user',
        userId: session.user.id,
        role: row.role,
        groupId,
        linkedMemberId: row.linkedMemberId,
        bypass: null,
      };
      if (!isAllowed(access, action)) throw new ApiError('FORBIDDEN', 403);
      return { access, group: row.group };
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
      return { access, group: row.group };
    }

    if (row.group.deletedAt) throw new ApiError('NOT_FOUND', 404);
    const share = await requireShareAccess(c, groupId, action);
    if (share) return { access: share, group: row.group };
    throw new ApiError('FORBIDDEN', 403);
  }

  const [group] = await c.var.db.select().from(groups).where(eq(groups.id, groupId)).limit(1);
  if (!group) throw new ApiError('NOT_FOUND', 404);
  if (group.deletedAt) throw new ApiError('NOT_FOUND', 404);
  const share = await requireShareAccess(c, groupId, action);
  if (share) return { access: share, group };
  throw new ApiError('UNAUTHORIZED', 401);
}

async function requireShareAccess(
  c: Context<AppEnv>,
  groupId: string,
  action: GroupAction,
): Promise<GroupAccess | null> {
  const share = await getCurrentShareSession(c);
  if (share?.groupId !== groupId) return null;
  const access: GroupAccess = { kind: 'share', ...share };
  if (!isAllowed(access, action)) throw new ApiError('FORBIDDEN', 403);
  return access;
}

/**
 * The member a caller is confined to writing as, or null when unconstrained.
 *
 * Share links may be bound to a single member, and a plain MEMBER may only act
 * as the member they are linked to. OWNER and MANAGER are unconstrained.
 */
export function boundMember(access: GroupAccess): string | null {
  if (access.kind === 'share') return access.boundMemberId;
  return access.role === 'MEMBER' ? access.linkedMemberId : null;
}

/** Stable id for "who did this", for audit rows and realtime events. */
export function actorId(access: GroupAccess): string {
  return access.kind === 'user' ? access.userId : access.shareLinkId;
}

/**
 * Resolve the permission matrix once, here, and ship the answers to the
 * client. The alternative — sending `role` and letting each component work it
 * out — is how the same rule ends up implemented twice.
 */
export function accessDto(access: GroupAccess): GroupAccessDto {
  return {
    kind: access.kind,
    userId: access.kind === 'user' ? access.userId : null,
    role: access.kind === 'user' ? access.role : null,
    scope: access.kind === 'share' ? access.scope : null,
    linkedMemberId: access.kind === 'user' ? access.linkedMemberId : access.boundMemberId,
    boundMemberId: boundMember(access),
    bypass: access.kind === 'user' ? access.bypass : null,
    canWriteExpense: isAllowed(access, 'WRITE_EXPENSE'),
    canManageMembers: isAllowed(access, 'MANAGE_MEMBERS'),
    canManageShares: isAllowed(access, 'MANAGE_SHARES'),
    canSettle: isAllowed(access, 'SETTLE'),
    canDeleteGroup: isAllowed(access, 'DELETE_GROUP'),
    // The role route requires DELETE_GROUP, so this is the same test the
    // server applies rather than a second guess at it.
    canManageRoles: isAllowed(access, 'DELETE_GROUP'),
    canTransferOwnership: access.kind === 'user' && access.role === 'OWNER' && !access.bypass,
    canLeaveGroup: access.kind === 'user' && access.role !== 'OWNER',
  };
}
