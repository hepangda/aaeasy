'use client';

import { useTranslations } from 'next-intl';
import { AddMemberForm } from './add-member-form';
import { RemoveMemberButton } from './remove-member-button';
import { UnlinkMemberButton } from './unlink-member-button';
import { MemberRenameButton } from './member-rename-button';
import { MemberRoleControl } from './member-role-control';
import { MemberShareDialog, type ExistingShareLink } from './member-share-dialog';
import { DeleteGroupButton } from './delete-group-button';
import { TransferOwnershipButton, type OwnerCandidate } from './transfer-ownership-button';
import { ReopenSettlementButton } from './reopen-settlement-button';
import { Pagination } from './ui/pagination';
import type { MemberLite } from '@/lib/expenses/queries';

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
  isArchived: boolean;
  settlementId?: string;
  existingShareLinks: ExistingShareLink[];
  baseUrl: string;
  ownerCandidates: OwnerCandidate[];
}

export function SettingsPanel({
  groupId,
  members,
  membersPage,
  isOwner,
  canManage,
  isArchived,
  settlementId,
  existingShareLinks,
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
        <ul className="divide-y rounded-md border">
          {membersPage.slice.map((m) => {
            const isLinked = !!m.linkedUserId;
            const displayName = isLinked
              ? (m.linkedUserDisplayName ?? m.displayName)
              : m.displayName;
            return (
              <li key={m.id} className="flex flex-col gap-2 px-4 py-3 text-sm">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-medium">{displayName}</span>
                    {m.linkedUsername && (
                      <span className="text-muted-foreground text-xs">
                        @{m.linkedUsername}
                      </span>
                    )}
                    {!isLinked && (
                      <span className="text-muted-foreground rounded border border-dashed px-2 py-0.5 text-xs">
                        {t('members.unlinked_badge')}
                      </span>
                    )}
                  </div>
                  <span className="flex items-center gap-1">
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
                    {canManage && m.linkedUserRole !== 'OWNER' && (
                      <MemberShareDialog
                        groupId={groupId}
                        memberId={m.id}
                        memberName={displayName}
                        memberLinked={isLinked}
                        canAssignManager={isOwner}
                        existingLinks={existingShareLinks.filter((l) => l.memberId === m.id)}
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
        <Pagination
          paramKey="mp"
          totalItems={members.length}
          pageSize={PAGE_SIZE_MEMBERS}
        />
      </div>

      {/* Ownership & Reopening Section */}
      {(isOwner || isArchived) && (
        <div className="border-t pt-6 flex flex-col gap-4">
          {isOwner && (
            <div className="flex flex-col gap-2">
              <h2 className="text-lg font-semibold">{t('groups.transfer_owner')}</h2>
              <p className="text-muted-foreground text-sm">
                {t('groups.transfer_owner_desc')}
              </p>
              <TransferOwnershipButton groupId={groupId} candidates={ownerCandidates} />
            </div>
          )}

          {isArchived && settlementId && (
            <div className="flex flex-col gap-2">
              <h2 className="text-lg font-semibold">{t('expenses.reopen_title')}</h2>
              <p className="text-muted-foreground text-sm">
                {t('expenses.reopen_desc')}
              </p>
              <ReopenSettlementButton settlementId={settlementId} />
            </div>
          )}
        </div>
      )}

      {/* Danger Zone */}
      {isOwner && (
        <div className="border-t pt-6 flex flex-col gap-2">
          <h2 className="text-lg font-semibold text-destructive">
            {t('account.danger_zone')}
          </h2>
          <p className="text-muted-foreground text-sm">
            {t('groups.delete_desc')}
          </p>
          <DeleteGroupButton groupId={groupId} />
        </div>
      )}
    </section>
  );
}
