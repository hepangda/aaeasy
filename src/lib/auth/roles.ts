import type { GroupRole } from '@prisma/client';

/**
 * Roles that can be permanently granted via share-link claim. OWNER is
 * intentionally excluded — ownership transfer goes through its own flow.
 */
export type AssignableRole = Exclude<GroupRole, 'OWNER'>;

/**
 * Numeric authority ranking used for "upgrade-only" merges (e.g. when a
 * user re-claims a member they already hold, with a higher-grade link
 * the second time, we keep the higher role; we never silently demote).
 *
 * OWNER (3) > MANAGER (2) > MEMBER (1) > VIEWER (0)
 */
export const ROLE_RANK: Record<GroupRole, number> = {
  OWNER: 3,
  MANAGER: 2,
  MEMBER: 1,
  VIEWER: 0,
};
