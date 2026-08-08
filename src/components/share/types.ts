import type { GroupRole, ShareScope } from '@aaeasy/contracts';

/**
 * Shared shape for share-link rows fed to both the group-level
 * <GroupShareDialog> and the per-member binding dialog. Lives in its own
 * file so renaming the dialog components doesn't break each other's
 * imports.
 */
export interface ExistingShareLink {
  id: string;
  memberId: string | null;
  /** Owner-set note (optional). Defaults to the member's display name when
   *  the link was created without one. Never shown to the visitor. */
  label: string | null;
  scope: ShareScope;
  /** Role granted when the link is claimed. Null on group-level links
   *  (those are anonymous view-only and never bind an account). */
  assignedRole: GroupRole | null;
  createdAt: string;
  expiresAt: string | null;
  /** Past `expiresAt` — link still works but read-only. */
  expired: boolean;
  /** Hard-killed by an OWNER/MANAGER. Visitor gets no access at all. */
  revoked: boolean;
}

/** A pending invitation, as rendered in the per-member binding dialog. */
export interface MemberPendingInvitationRow {
  id: string;
  memberId: string;
  assignedRole: GroupRole;
  createdAt: string | Date;
  invitedUser: { id: string; displayName: string; username: string | null };
  invitedBy: { id: string; displayName: string } | null;
}
