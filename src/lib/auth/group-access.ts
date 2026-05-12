/**
 * Unified group-access resolver.
 *
 * Returns a typed context describing how the caller is authorized — either as
 * a logged-in `user` (with a `GroupRole` and, when applicable, the linked
 * Member.id), or as an anonymous `share` visitor with a `ShareScope`.
 *
 * Capability matrix — see `isAllowed` for the source of truth:
 *
 *   READ_GROUP        OWNER, MANAGER, MEMBER, VIEWER, share (any)
 *   WRITE_EXPENSE     OWNER, MANAGER, MEMBER (must be payer),
 *                     share WRITE (bound: must be payer)
 *   MANAGE_MEMBERS    OWNER, MANAGER
 *   MANAGE_SHARES     OWNER, MANAGER
 *   SETTLE            OWNER, MANAGER
 *   DELETE_GROUP      OWNER
 *
 * The "must be payer / involved" constraints are enforced at the action
 * layer using `linkedMemberId` (for users) or `boundMemberId` (for share
 * visitors); this gate only answers "may they attempt this action at all?".
 */

import { prisma } from '@/lib/db';
import { getCurrentSession } from './session';
import { getCurrentShareSession } from './share-session';
import type { GroupRole, ShareScope } from '@prisma/client';

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
      /** When the signed-in user is linked to a Member of this group, that
       *  member's id. Used by MEMBER role to gate writes to "self only". */
      linkedMemberId: string | null;
    }
  | {
      kind: 'share';
      shareLinkId: string;
      scope: ShareScope;
      groupId: string;
      /** Member the link was issued for. When set, all writes via this
       *  share must involve this member (e.g. payerMemberId === bound).
       *  Null = generic unbound link (legacy / OWNER-issued read-only). */
      boundMemberId: string | null;
    };

export class AccessError extends Error {
  constructor(public code: 'UNAUTHENTICATED' | 'NOT_FOUND' | 'FORBIDDEN') {
    super(code);
    this.name = 'AccessError';
  }
}

function isAllowed(access: GroupAccess, action: GroupAction): boolean {
  if (access.kind === 'user') {
    const r = access.role;
    switch (action) {
      case 'READ_GROUP':
        return true;
      case 'WRITE_EXPENSE':
        // MEMBER may attempt writes only if they're linked to a member;
        // the per-action constraint (must be payer / involved) is checked
        // in the action itself.
        if (r === 'OWNER' || r === 'MANAGER') return true;
        if (r === 'MEMBER') return access.linkedMemberId !== null;
        return false;
      case 'MANAGE_MEMBERS':
      case 'MANAGE_SHARES':
      case 'SETTLE':
        return r === 'OWNER' || r === 'MANAGER';
      case 'DELETE_GROUP':
        return r === 'OWNER';
    }
  } else {
    switch (action) {
      case 'READ_GROUP':
        return true;
      case 'WRITE_EXPENSE':
        // A share visitor can write only when:
        //   - the link is bound to a member (bound-write semantics), OR
        //   - the link is a legacy unbound WRITE link.
        return access.boundMemberId !== null || access.scope === 'WRITE';
      case 'MANAGE_MEMBERS':
      case 'MANAGE_SHARES':
      case 'SETTLE':
      case 'DELETE_GROUP':
        return false;
    }
  }
}

/**
 * Resolve and authorize. Throws AccessError on any failure. Use the returned
 * context to read `kind`, `groupId`, `linkedMemberId` etc.
 */
export async function requireGroupAccess(
  groupId: string,
  action: GroupAction,
): Promise<GroupAccess> {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { id: true },
  });
  if (!group) throw new AccessError('NOT_FOUND');

  const userCtx = await getCurrentSession();
  if (userCtx) {
    const m = await prisma.groupMembership.findUnique({
      where: { userId_groupId: { userId: userCtx.user.id, groupId } },
      select: { role: true },
    });
    if (m) {
      // Look up the linked Member, if any. This is what gates MEMBER
      // role writes to "self only".
      const linked = await prisma.member.findFirst({
        where: { groupId, linkedUserId: userCtx.user.id },
        select: { id: true },
      });
      const access: GroupAccess = {
        kind: 'user',
        userId: userCtx.user.id,
        role: m.role,
        groupId,
        linkedMemberId: linked?.id ?? null,
      };
      if (!isAllowed(access, action)) throw new AccessError('FORBIDDEN');
      return access;
    }
  }

  const share = await getCurrentShareSession();
  if (share && share.groupId === groupId) {
    const access: GroupAccess = {
      kind: 'share',
      shareLinkId: share.shareLinkId,
      scope: share.scope,
      groupId,
      boundMemberId: share.boundMemberId,
    };
    if (!isAllowed(access, action)) throw new AccessError('FORBIDDEN');
    return access;
  }

  throw new AccessError(userCtx ? 'FORBIDDEN' : 'UNAUTHENTICATED');
}
