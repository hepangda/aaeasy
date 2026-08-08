import { useTranslations } from 'use-intl';
import { DeleteGroupButton } from '@/components/group/delete-group-button';
import { LeaveGroupButton } from '@/components/group/leave-group-button';
import {
  TransferOwnershipButton,
  type OwnerCandidate,
} from '@/components/group/transfer-ownership-button';
import { ExportMenu } from '@/components/settle/export-menu';
import { ReopenSettlementButton } from '@/components/settle/reopen-settlement-button';
import { SettleButton } from '@/components/settle/settle-button';
import { GroupShareDialog } from '@/components/share/group-share-dialog';
import type { ExistingShareLink } from '@/components/share/types';
import { Card } from '@/components/ui/card';
import { DangerZone } from '@/components/ui/danger-zone';
import { SectionHeader } from '@/components/ui/page-header';

export type { MemberLite } from './types';

/**
 * Group-level settings: archiving, sharing, exporting, ownership, reopening a
 * settlement, and the destructive operations.
 *
 * Archive/share/export used to live in the ledger header (one as a primary
 * button, two behind an unlabelled `⋯`), which gave them no room to explain
 * themselves and hid them from anyone who did not open the menu. They are
 * settings, so they live here with a title and a description each.
 *
 * The danger zone is a sibling card, not a nested one. Wrapping the whole panel
 * in a single card put the red block *inside* the ownership card, which read as
 * "delete" belonging to "transfer ownership".
 */
export function SettingsPanel({
  groupId,
  canDeleteGroup,
  canTransferOwnership,
  canLeave,
  canSettle,
  isArchived,
  settlementId,
  ownerCandidates,
  canShare = false,
  canExport = false,
  shareLinks = [],
  baseUrl = '',
  openExpenseCount = 0,
}: {
  groupId: string;
  canDeleteGroup: boolean;
  canTransferOwnership: boolean;
  canSettle: boolean;
  canLeave: boolean;
  isArchived: boolean;
  settlementId?: string;
  ownerCandidates: OwnerCandidate[];
  canShare?: boolean;
  canExport?: boolean;
  shareLinks?: ExistingShareLink[];
  baseUrl?: string;
  openExpenseCount?: number;
}) {
  const t = useTranslations();
  const canReopen = Boolean(isArchived && canSettle && settlementId);
  const canArchive = canSettle && !isArchived;

  return (
    <div className="flex flex-col gap-5">
      {canArchive ? (
        <Card as="section" padding="body" className="flex flex-col gap-3">
          <SectionHeader
            title={t('settlements.settle_button')}
            description={t('settlements.settle_desc')}
          />
          <div>
            <SettleButton groupId={groupId} openExpenseCount={openExpenseCount} />
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
            <ReopenSettlementButton groupId={groupId} settlementId={settlementId!} />
          </div>
        </Card>
      ) : null}

      {canShare ? (
        <Card as="section" padding="body" className="flex flex-col gap-3">
          <SectionHeader
            title={t('share.group_dialog_title')}
            description={t('share.group_dialog_desc')}
          />
          <div>
            <GroupShareDialog groupId={groupId} existingLinks={shareLinks} baseUrl={baseUrl} />
          </div>
        </Card>
      ) : null}

      {canExport ? (
        <Card as="section" padding="body" className="flex flex-col gap-3">
          <SectionHeader title={t('export.title')} description={t('export.desc')} />
          <div className="flex flex-wrap gap-2">
            <ExportMenu groupId={groupId} />
          </div>
        </Card>
      ) : null}

      {canTransferOwnership ? (
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

      {canDeleteGroup || canLeave ? (
        <DangerZone
          title={t('account.danger_zone')}
          description={canDeleteGroup ? t('groups.delete_desc') : t('groups.leave_desc')}
        >
          {canDeleteGroup ? (
            <DeleteGroupButton groupId={groupId} />
          ) : (
            <LeaveGroupButton groupId={groupId} />
          )}
        </DangerZone>
      ) : null}
    </div>
  );
}
