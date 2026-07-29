import { useTranslations } from 'use-intl';
import { DeleteGroupButton } from '@/components/group/delete-group-button';
import { LeaveGroupButton } from '@/components/group/leave-group-button';
import {
  TransferOwnershipButton,
  type OwnerCandidate,
} from '@/components/group/transfer-ownership-button';
import { ReopenSettlementButton } from '@/components/settle/reopen-settlement-button';
import { Card } from '@/components/ui/card';
import { DangerZone } from '@/components/ui/danger-zone';
import { SectionHeader } from '@/components/ui/page-header';

export type { MemberLite } from './types';

/**
 * Group-level settings: ownership, reopening a settlement, and the destructive
 * operations.
 *
 * The danger zone is a sibling card, not a nested one. Wrapping the whole panel
 * in a single card put the red block *inside* the ownership card, which read as
 * "delete" belonging to "transfer ownership".
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
  const canReopen = Boolean(isArchived && canSettle && settlementId);

  return (
    <div className="flex flex-col gap-5">
      {isOwner ? (
        <Card as="section" padding="body" className="flex flex-col gap-3">
          <SectionHeader
            title={t('groups.transfer_owner')}
            description={t('groups.transfer_owner_desc')}
          />
          <div>
            <TransferOwnershipButton groupId={groupId} candidates={ownerCandidates} />
          </div>
        </Card>
      ) : null}

      {canReopen ? (
        <Card as="section" padding="body" className="flex flex-col gap-3">
          <SectionHeader
            title={t('expenses.reopen_title')}
            description={t('expenses.reopen_desc')}
          />
          <div>
            <ReopenSettlementButton settlementId={settlementId!} />
          </div>
        </Card>
      ) : null}

      <DangerZone
        title={t('account.danger_zone')}
        description={isOwner ? t('groups.delete_desc') : t('groups.leave_desc')}
      >
        {isOwner ? <DeleteGroupButton groupId={groupId} /> : <LeaveGroupButton groupId={groupId} />}
      </DangerZone>
    </div>
  );
}
