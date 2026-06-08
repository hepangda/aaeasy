import type { ShareScope } from '@prisma/client';

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
  createdAt: string;
  expiresAt: string | null;
  /** Past `expiresAt` — link still works but read-only. */
  expired: boolean;
  /** Hard-killed by an OWNER/MANAGER. Visitor gets no access at all. */
  revoked: boolean;
}
