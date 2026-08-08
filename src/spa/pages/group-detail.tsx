import Link from '@/router/link';
import { Navigate, useParams, useSearchParams } from 'react-router';
import { useFormatter, useLocale, useTranslations } from 'use-intl';
import { Plus } from 'lucide-react';
import { GroupLiveRefresher } from '@/components/group/group-live-refresher';
import { MembersPanel } from '@/components/group/members-panel';
import { SettingsPanel } from '@/components/group/settings-panel';
import type { OwnerCandidate } from '@/components/group/transfer-ownership-button';
import { ExpenseFeed } from '@/components/ledger/expense-feed';
import { LedgerPageHeader } from '@/components/ledger/ledger-page-header';
import { LedgerSummaryTable } from '@/components/ledger/ledger-summary-table';
import { SettlementStatus } from '@/components/settle/settlement-status';
import { TransfersPanel } from '@/components/settle/transfers-panel';
import type { ExistingShareLink } from '@/components/share/types';
import { Button } from '@/components/ui/button';
import { Tabs } from '@/components/ui/tabs';
import { formatMinor, formatMoney } from '@aaeasy/core/money';
import { parsePageNumber } from '@aaeasy/core/pagination';
import { ErrorPage } from '../page-state';
import { SkeletonPage } from '@/components/ui/skeleton';
import { Card } from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { useGroupQuery, useLedgerQuery } from '../queries';

function errorStatus(error: unknown): number | undefined {
  return error && typeof error === 'object' && 'status' in error ? Number(error.status) : undefined;
}

export function GroupDetailPage() {
  const groupId = useParams<{ groupId: string }>().groupId ?? '';
  const [searchParams] = useSearchParams();
  const requestedExpensePage = parsePageNumber(searchParams.get('ep'));
  const t = useTranslations();
  const fmt = useFormatter();
  const locale = useLocale();
  const detail = useGroupQuery(groupId);
  const ledgerQuery = useLedgerQuery(groupId, requestedExpensePage);

  if (detail.isPending || ledgerQuery.isPending) return <SkeletonPage rows={6} />;
  const error = detail.error ?? ledgerQuery.error;
  if (errorStatus(error) === 401) {
    return <Navigate to={`/login?next=${encodeURIComponent(`/groups/${groupId}`)}`} replace />;
  }
  if (detail.isError || ledgerQuery.isError) return <ErrorPage error={error} />;

  const { access } = detail.data;
  const ledger = ledgerQuery.data;
  const { group, members, expenses, summary, transfers } = ledger;
  const memberById = new Map(members.map((member) => [member.id, member]));
  // Every permission below is the server's answer, verbatim. Re-deriving them
  // from `role` here is how the rule ends up written twice and drifts.
  const isSuperAdminBypass = access.bypass === 'superadmin';
  const canManage = access.canManageMembers;
  const boundMemberId = access.boundMemberId;
  const isArchived = group.status === 'ARCHIVED';
  const canWrite = !isArchived && access.canWriteExpense;
  const canMarkPaid = access.canWriteExpense;
  const openExpenseCount = ledger.openExpenseCount;
  const existingShareLinks: ExistingShareLink[] = detail.data.shareLinks.map((link) => ({
    ...link,
    createdAt: fmt.dateTime(new Date(link.createdAt), 'short'),
    expiresAt: link.expiresAt ? fmt.dateTime(new Date(link.expiresAt), 'short') : null,
  }));
  const pendingInvitations = detail.data.pendingInvitations.flatMap((invitation) =>
    invitation.invitedUser
      ? [
          {
            ...invitation,
            invitedUser: invitation.invitedUser,
            invitedBy: invitation.invitedBy
              ? { id: invitation.invitedBy.id, displayName: invitation.invitedBy.displayName }
              : null,
          },
        ]
      : [],
  );
  const ownerCandidates: OwnerCandidate[] = access.canTransferOwnership
    ? members
        .filter(
          (member) =>
            member.linkedUserId !== null &&
            member.linkedUserId !== access.userId &&
            member.linkedUsername !== null,
        )
        .map((member) => ({
          userId: member.linkedUserId as string,
          label: `${member.displayName} (@${member.linkedUsername})`,
        }))
    : [];

  return (
    <PageShell>
      <GroupLiveRefresher groupId={groupId} />
      <LedgerPageHeader
        name={group.name}
        currency={group.defaultCurrency}
        members={members}
        archived={isArchived}
      />

      {isSuperAdminBypass ? (
        <p className="border-destructive/40 bg-destructive/10 text-destructive-ink rounded-xl border px-4 py-3 text-sm font-semibold">
          {t('admin.bypass_banner')}
        </p>
      ) : null}
      {isArchived ? (
        <p className="bg-secondary text-secondary-foreground rounded-xl border px-4 py-3 text-sm">
          {t('groups.archived_banner')}
        </p>
      ) : null}

      <div className="-mt-2">
        <Tabs
          defaultTab={isArchived ? 'settlement' : 'expenses'}
          alsoInBottomNav={access.kind === 'user'}
          hashAliases={{ summary: 'settlement', transfers: 'settlement' }}
          tabs={[
            {
              id: 'expenses',
              label: t('expenses.title'),
              badge: openExpenseCount || undefined,
              content: (
                <section className="flex min-w-0 flex-col gap-4">
                  <ExpenseFeed
                    groupId={groupId}
                    expenses={expenses}
                    totalItems={ledger.expensePage.totalItems}
                    pageSize={ledger.expensePage.pageSize}
                    members={members}
                    canWrite={canWrite}
                    boundMemberId={boundMemberId}
                    action={
                      canWrite ? (
                        <Button
                          asChild
                          size="sm"
                          className={access.kind === 'user' ? 'hidden lg:inline-flex' : undefined}
                        >
                          <Link href={`/groups/${groupId}/expenses/new`}>
                            <Plus /> {t('expenses.add')}
                          </Link>
                        </Button>
                      ) : undefined
                    }
                  />
                </section>
              ),
            },
            {
              id: 'settlement',
              label: t('settlements.title'),
              badge: transfers.length || undefined,
              content: (
                <section className="flex flex-col gap-4">
                  <SettlementStatus pendingTransfers={transfers.length} />
                  <Card padding="body">
                    <TransfersPanel
                      groupId={groupId}
                      members={members.map((member) => ({
                        id: member.id,
                        displayName: member.displayName,
                      }))}
                      defaultCurrency={group.defaultCurrency}
                      canEdit={canMarkPaid}
                      boundMemberId={boundMemberId}
                      suggested={transfers.map((transfer) => ({
                        fromMemberId: transfer.from,
                        toMemberId: transfer.to,
                        fromName: memberById.get(transfer.from)?.displayName ?? '?',
                        toName: memberById.get(transfer.to)?.displayName ?? '?',
                        amountText: formatMoney(
                          transfer.amountMinor,
                          group.defaultCurrency,
                          locale,
                        ),
                        amountMajor: formatMinor(transfer.amountMinor, group.defaultCurrency),
                      }))}
                      executed={ledger.settlementEntries.map((entry) => ({
                        id: entry.id,
                        fromMemberId: entry.fromMemberId,
                        toMemberId: entry.toMemberId,
                        fromName: memberById.get(entry.fromMemberId)?.displayName ?? '?',
                        toName: memberById.get(entry.toMemberId)?.displayName ?? '?',
                        amountText: formatMoney(entry.amountMinor, group.defaultCurrency, locale),
                        occurredAt: fmt.dateTime(entry.occurredAt, 'short'),
                        note: entry.note,
                        createdByName: entry.createdByName,
                      }))}
                    />
                  </Card>
                  <LedgerSummaryTable
                    summary={summary}
                    members={members}
                    currency={group.defaultCurrency}
                    hasSettlementEntries={ledger.settlementEntries.length > 0}
                  />
                </section>
              ),
            },
            {
              id: 'members',
              label: t('members.title'),
              badge: members.length || undefined,
              content: (
                <Card as="section" padding="body">
                  <MembersPanel
                    groupId={groupId}
                    members={members}
                    canManage={canManage}
                    canManageRoles={access.canManageRoles}
                    existingShareLinks={existingShareLinks.filter((link) => link.memberId !== null)}
                    pendingInvitations={pendingInvitations}
                    baseUrl={window.location.origin}
                  />
                </Card>
              ),
            },
            ...(access.kind === 'user'
              ? [
                  {
                    id: 'settings',
                    label: t('groups.settings_short'),
                    content: (
                      <SettingsPanel
                        groupId={groupId}
                        canDeleteGroup={access.canDeleteGroup}
                        canTransferOwnership={access.canTransferOwnership}
                        canLeave={access.canLeaveGroup}
                        canSettle={access.canSettle}
                        isArchived={isArchived}
                        settlementId={detail.data.activeSettlementId ?? undefined}
                        ownerCandidates={ownerCandidates}
                        canShare={canManage}
                        canExport
                        shareLinks={existingShareLinks.filter((link) => link.memberId === null)}
                        baseUrl={window.location.origin}
                        openExpenseCount={openExpenseCount}
                      />
                    ),
                  },
                ]
              : []),
          ]}
        />
      </div>
    </PageShell>
  );
}
