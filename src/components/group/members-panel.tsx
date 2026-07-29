import { useTranslations } from 'use-intl';
import { AddMemberForm } from '@/components/group/add-member-form';
import { RemoveMemberButton } from '@/components/group/remove-member-button';
import { UnlinkMemberButton } from '@/components/group/unlink-member-button';
import { MemberRenameButton } from '@/components/group/member-rename-button';
import { MemberRoleControl } from '@/components/group/member-role-control';
import { AccountBindingDialog } from '@/components/share/account-binding-dialog';
import type { ExistingShareLink } from '@/components/share/types';
import type { MemberPendingInvitationRow } from '@/components/share/account-binding-dialog';
import { Pagination } from '@/components/ui/pagination';
import type { MemberLite } from './types';

export const PAGE_SIZE_MEMBERS = 12;

/**
 * Who is in this ledger, and how each person is linked to an account.
 *
 * Split out of the former "Members & settings" tab: rosters and destructive
 * group operations are different jobs, and bundling them meant a user looking
 * for one had to scan past the other.
 */
export function MembersPanel({
  groupId,
  members,
  membersPage,
  isOwner,
  canManage,
  existingShareLinks,
  pendingInvitations,
  baseUrl,
}: {
  groupId: string;
  members: MemberLite[];
  membersPage: { slice: MemberLite[]; page: number; totalPages: number };
  isOwner: boolean;
  canManage: boolean;
  existingShareLinks: ExistingShareLink[];
  pendingInvitations: MemberPendingInvitationRow[];
  baseUrl: string;
}) {
  const t = useTranslations();

  return (
    <section className="flex flex-col gap-4">
      {canManage && <AddMemberForm groupId={groupId} />}
      <ul className="divide-y rounded-lg border">
        {membersPage.slice.map((m) => {
          const isLinked = !!m.linkedUserId;
          const displayName = isLinked ? (m.linkedUserDisplayName ?? m.displayName) : m.displayName;
          return (
            <li key={m.id} className="flex flex-col gap-2 px-4 py-3 text-sm">
              <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-semibold">{displayName}</span>
                  {m.linkedUsername && (
                    <span className="text-muted-foreground text-xs">@{m.linkedUsername}</span>
                  )}
                  {!isLinked && (
                    <span className="text-muted-foreground rounded-md border border-dashed px-2 py-0.5 text-xs">
                      {t('members.unlinked_badge')}
                    </span>
                  )}
                </div>
                <span className="flex flex-wrap items-center justify-end gap-1">
                  {isLinked && m.linkedUserRole && (
                    <MemberRoleControl
                      groupId={groupId}
                      memberId={m.id}
                      currentRole={m.linkedUserRole}
                      editable={isOwner && m.linkedUserRole !== 'OWNER'}
                    />
                  )}
                  {canManage && !isLinked && (
                    <MemberRenameButton
                      groupId={groupId}
                      memberId={m.id}
                      currentName={m.displayName}
                    />
                  )}
                  {canManage && !isLinked && m.linkedUserRole !== 'OWNER' && (
                    <AccountBindingDialog
                      groupId={groupId}
                      memberId={m.id}
                      memberName={displayName}
                      canAssignManager={isOwner}
                      existingLinks={existingShareLinks.filter((l) => l.memberId === m.id)}
                      pendingInvitations={pendingInvitations.filter((inv) => inv.memberId === m.id)}
                      baseUrl={baseUrl}
                    />
                  )}
                  {isOwner && isLinked && m.linkedUserRole !== 'OWNER' && (
                    <UnlinkMemberButton groupId={groupId} memberId={m.id} />
                  )}
                  {canManage && !isLinked && (
                    <RemoveMemberButton groupId={groupId} memberId={m.id} />
                  )}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      <Pagination paramKey="mp" totalItems={members.length} pageSize={PAGE_SIZE_MEMBERS} />
    </section>
  );
}
