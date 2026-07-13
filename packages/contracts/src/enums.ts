import { z } from 'zod';

export const groupRoleSchema = z.enum(['OWNER', 'MANAGER', 'MEMBER', 'VIEWER']);
export type GroupRole = z.infer<typeof groupRoleSchema>;

export const groupStatusSchema = z.enum(['ACTIVE', 'ARCHIVED']);
export type GroupStatus = z.infer<typeof groupStatusSchema>;

export const shareScopeSchema = z.enum(['READ', 'WRITE']);
export type ShareScope = z.infer<typeof shareScopeSchema>;

export const invitationStatusSchema = z.enum([
  'PENDING',
  'ACCEPTED',
  'REJECTED',
  'CANCELED',
  'EXPIRED',
]);
export type InvitationStatus = z.infer<typeof invitationStatusSchema>;

export const GROUP_ROLE_RANK: Record<GroupRole, number> = {
  VIEWER: 0,
  MEMBER: 1,
  MANAGER: 2,
  OWNER: 3,
};
