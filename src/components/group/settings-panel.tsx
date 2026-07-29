import { useTranslations } from 'use-intl';
import { DeleteGroupButton } from '@/components/group/delete-group-button';
import { LeaveGroupButton } from '@/components/group/leave-group-button';
import {
  TransferOwnershipButton,
  type OwnerCandidate,
} from '@/components/group/transfer-ownership-button';
import { ReopenSettlementButton } from '@/components/settle/reopen-settlement-button';
import { DangerZone } from '@/components/ui/danger-zone';
import { SectionHeader } from '@/components/ui/page-header';

export type { MemberLite } from './types';

/**
 * Group-level settings: ownership, reopening a settlement, and the destructive
 * operations. The member roster lives in its own panel — the two were bundled
 * under "Members & settings", which made the tab a catch-all.
 */
export function SettingsPanel({
  groupId,
  isOwner,
  canSettle,
  isArchived,
  settlementId,
  ownerCandidates,
}: {
  groupId: string;
  isOwner: boolean;
  canSettle: boolean;
  isArchived: boolean;
  settlementId?: string;
  ownerCandidates: OwnerCandidate[];
}) {
  const t = useTranslations();
  const showOwnership = isOwner || (isArchived && canSettle && settlementId);

  return (
    <section className="flex flex-col gap-6">
      {showOwnership ? (
        <div className="flex flex-col gap-5">
          {isOwner ? (
            <div className="flex flex-col gap-3">
              <SectionHeader
                title={t('groups.transfer_owner')}
                description={t('groups.transfer_owner_desc')}
              />
              <div>
                <TransferOwnershipButton groupId={groupId} candidates={ownerCandidates} />
              </div>
            </div>
          ) : null}

          {isArchived && canSettle && settlementId ? (
            <div className="flex flex-col gap-3">
              <SectionHeader
                title={t('expenses.reopen_title')}
                description={t('expenses.reopen_desc')}
              />
              <div>
                <ReopenSettlementButton settlementId={settlementId} />
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <DangerZone
        title={t('account.danger_zone')}
        description={isOwner ? t('groups.delete_desc') : t('groups.leave_desc')}
      >
        {isOwner ? <DeleteGroupButton groupId={groupId} /> : <LeaveGroupButton groupId={groupId} />}
      </DangerZone>
    </section>
  );
}
