import { useTranslations } from 'use-intl';
import { AddMemberForm } from '@/components/group/add-member-form';
import { RemoveMemberButton } from '@/components/group/remove-member-button';
import { UnlinkMemberButton } from '@/components/group/unlink-member-button';
import { MemberRenameButton } from '@/components/group/member-rename-button';
import { MemberRoleControl } from '@/components/group/member-role-control';
import { AccountBindingDialog } from '@/components/share/account-binding-dialog';
import type { ExistingShareLink } from '@/components/share/types';
import type { MemberPendingInvitationRow } from '@/components/share/account-binding-dialog';
import { DeleteGroupButton } from '@/components/group/delete-group-button';
import { LeaveGroupButton } from '@/components/group/leave-group-button';
import {
  TransferOwnershipButton,
  type OwnerCandidate,
} from '@/components/group/transfer-ownership-button';
import { ReopenSettlementButton } from '@/components/settle/reopen-settlement-button';
import { Pagination } from '@/components/ui/pagination';

export interface MemberLite {
  id: string;
  displayName: string;
  sortOrder: number;
  linkedUserId: string | null;
  linkedUsername: string | null;
  linkedUserDisplayName: string | null;
  linkedUserRole: 'OWNER' | 'MANAGER' | 'MEMBER' | 'VIEWER' | null;
  color: string | null;
}

const PAGE_SIZE_MEMBERS = 12;

interface SettingsPanelProps {
  groupId: string;
  members: MemberLite[];
  membersPage: {
    slice: MemberLite[];
    page: number;
    totalPages: number;
  };
  isOwner: boolean;
  canManage: boolean;
  canSettle: boolean;
  isArchived: boolean;
  settlementId?: string;
  existingShareLinks: ExistingShareLink[];
  pendingInvitations: MemberPendingInvitationRow[];
  baseUrl: string;
  ownerCandidates: OwnerCandidate[];
}

export function SettingsPanel({
  groupId,
  members,
  membersPage,
  isOwner,
  canManage,
  canSettle,
  isArchived,
  settlementId,
  existingShareLinks,
  pendingInvitations,
  baseUrl,
  ownerCandidates,
}: SettingsPanelProps) {
  const t = useTranslations();

  return (
    <section className="flex flex-col gap-6">
      {/* Members Section */}
      <div className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">{t('members.title')}</h2>
        {canManage && <AddMemberForm groupId={groupId} />}
        <ul className="divide-y rounded-xl border">
          {membersPage.slice.map((m) => {
            const isLinked = !!m.linkedUserId;
            const displayName = isLinked
              ? (m.linkedUserDisplayName ?? m.displayName)
              : m.displayName;
            return (
              <li key={m.id} className="flex flex-col gap-2 px-4 py-3 text-sm">
                <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-medium">{displayName}</span>
                    {m.linkedUsername && (
                      <span className="text-muted-foreground text-xs">@{m.linkedUsername}</span>
                    )}
                    {!isLinked && (
                      <span className="text-muted-foreground rounded border border-dashed px-2 py-0.5 text-xs">
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
                        pendingInvitations={pendingInvitations.filter(
                          (inv) => inv.memberId === m.id,
                        )}
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
      </div>

      {/* Ownership & Reopening Section */}
      {(isOwner || (isArchived && canSettle)) && (
        <div className="flex flex-col gap-4 border-t pt-6">
          {isOwner && (
            <div className="flex flex-col gap-2">
              <h2 className="text-lg font-semibold">{t('groups.transfer_owner')}</h2>
              <p className="text-muted-foreground text-sm">{t('groups.transfer_owner_desc')}</p>
              <TransferOwnershipButton groupId={groupId} candidates={ownerCandidates} />
            </div>
          )}

          {isArchived && canSettle && settlementId && (
            <div className="flex flex-col gap-2">
              <h2 className="text-lg font-semibold">{t('expenses.reopen_title')}</h2>
              <p className="text-muted-foreground text-sm">{t('expenses.reopen_desc')}</p>
              <ReopenSettlementButton settlementId={settlementId} />
            </div>
          )}
        </div>
      )}

      {/* Danger Zone */}
      {isOwner ? (
        <div className="flex flex-col gap-2 border-t pt-6">
          <h2 className="text-destructive-ink text-lg font-semibold">{t('account.danger_zone')}</h2>
          <p className="text-muted-foreground text-sm">{t('groups.delete_desc')}</p>
          <DeleteGroupButton groupId={groupId} />
        </div>
      ) : (
        <div className="flex flex-col gap-2 border-t pt-6">
          <h2 className="text-destructive-ink text-lg font-semibold">{t('account.danger_zone')}</h2>
          <p className="text-muted-foreground text-sm">{t('groups.leave_desc')}</p>
          <LeaveGroupButton groupId={groupId} />
        </div>
      )}
    </section>
  );
}
