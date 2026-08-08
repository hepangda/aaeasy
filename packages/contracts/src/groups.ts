import { z } from 'zod';
import { shareScopeSchema, type GroupRole } from './enums';
import {
  KEYFORGE_ALIAS_MAX_LENGTH,
  KEYFORGE_ALIAS_MIN_LENGTH,
  KEYFORGE_ALIAS_PATTERN,
} from './identity';
import { currencyCodeSchema } from './money';

export const memberChipSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('name'), text: z.string().trim().min(1).max(40) }),
  z.object({
    kind: z.literal('mention'),
    username: z
      .string()
      .trim()
      .toLowerCase()
      .min(KEYFORGE_ALIAS_MIN_LENGTH)
      .max(KEYFORGE_ALIAS_MAX_LENGTH)
      .regex(KEYFORGE_ALIAS_PATTERN),
  }),
]);

export const createGroupSchema = z.object({
  name: z.string().trim().min(1).max(64),
  defaultCurrency: currencyCodeSchema.default('CNY'),
  members: z.array(memberChipSchema).max(49).default([]),
});

export const renameGroupSchema = z.object({
  name: z.string().trim().min(1).max(64),
});

export const createMemberSchema = z.object({
  displayName: z.string().trim().min(1).max(40),
});

export const updateMemberSchema = z.object({
  displayName: z.string().trim().min(1).max(40).optional(),
  role: z.enum(['MANAGER', 'MEMBER', 'VIEWER']).optional(),
});

export const inviteMemberSchema = z.object({
  memberId: z.string().min(1),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(KEYFORGE_ALIAS_MIN_LENGTH)
    .max(KEYFORGE_ALIAS_MAX_LENGTH)
    .regex(KEYFORGE_ALIAS_PATTERN),
  assignedRole: z.enum(['MANAGER', 'MEMBER']).default('MEMBER'),
  message: z.string().trim().max(200).optional(),
});

export const createShareLinkSchema = z.object({
  memberId: z.string().min(1).nullable().optional(),
  scope: shareScopeSchema,
  assignedRole: z.enum(['MANAGER', 'MEMBER', 'VIEWER']).nullable().optional(),
  label: z.string().trim().max(100).nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

export interface GroupListItemDto {
  id: string;
  name: string;
  status: 'ACTIVE' | 'ARCHIVED';
  defaultCurrency: string;
  role: GroupRole;
  memberCount: number;
  updatedAt: string;
}

/**
 * Everything the client needs to decide what to render, decided once on the
 * server. The booleans are authoritative: clients must not re-derive them from
 * `role`/`kind`, or the rule ends up written twice and drifts.
 */
export interface GroupAccessDto {
  kind: 'user' | 'share';
  userId: string | null;
  role: GroupRole | null;
  scope: 'READ' | 'WRITE' | null;
  /** The member row this caller *is*, when there is one. */
  linkedMemberId: string | null;
  /**
   * The member this caller may only write as, or null when unconstrained.
   * Differs from `linkedMemberId` for owners and managers, who are linked to a
   * member but may act for anyone.
   */
  boundMemberId: string | null;
  bypass: 'superadmin' | null;
  canWriteExpense: boolean;
  canManageMembers: boolean;
  canManageShares: boolean;
  canSettle: boolean;
  canDeleteGroup: boolean;
  /** Assigning roles is owner-level, same as deleting the group. */
  canManageRoles: boolean;
  /** Owners only, and never through the super-admin bypass. */
  canTransferOwnership: boolean;
  /** Owners cannot leave a group they still own. */
  canLeaveGroup: boolean;
}
