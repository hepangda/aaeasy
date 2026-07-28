import Link from '@/compat/link';
import { Navigate, useParams, useSearchParams } from 'react-router';
import { useFormatter, useLocale, useTranslations } from 'use-intl';
import { Plus } from 'lucide-react';
import { DraftFillPanel, type DraftRow } from '@/components/expense/draft-fill-panel';
import { GroupLiveRefresher } from '@/components/group/group-live-refresher';
import { SettingsPanel } from '@/components/group/settings-panel';
import type { OwnerCandidate } from '@/components/group/transfer-ownership-button';
import { ExpenseReceiptFeed } from '@/components/ledger/expense-feed';
import { LedgerPageHeader } from '@/components/ledger/ledger-page-header';
import { LedgerSummaryTable } from '@/components/ledger/ledger-summary-table';
import { ExportMenu } from '@/components/settle/export-menu';
import { SettlementStatus } from '@/components/settle/settlement-status';
import { SettleButton } from '@/components/settle/settle-button';
import { TransfersPanel } from '@/components/settle/transfers-panel';
import { GroupShareDialog } from '@/components/share/group-share-dialog';
import type { ExistingShareLink } from '@/components/share/types';
import { Button } from '@/components/ui/button';
import { Tabs } from '@/components/ui/tabs';
import { formatMinor, formatMoney } from '@/lib/money';
import { getPageSlice } from '@/lib/pagination';
import { ErrorPage } from '../page-state';
import { SkeletonPage } from '@/components/ui/skeleton';
import { useGroupQuery, useLedgerQuery } from '../queries';

const PAGE_SIZE_EXPENSES = 10;
const PAGE_SIZE_MEMBERS = 12;

function errorStatus(error: unknown): number | undefined {
  return error && typeof error === 'object' && 'status' in error ? Number(error.status) : undefined;
}

export function GroupDetailPage() {
  const groupId = useParams<{ groupId: string }>().groupId ?? '';
  const [searchParams] = useSearchParams();
  const t = useTranslations();
  const fmt = useFormatter();
  const locale = useLocale();
  const detail = useGroupQuery(groupId);
  const ledgerQuery = useLedgerQuery(groupId);

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
  const role = access.role;
  const isSuperAdminBypass = access.bypass === 'superadmin';
  const isOwner = role === 'OWNER';
  const canManage = access.canManageMembers;
  const boundMemberId = access.kind === 'share' || role === 'MEMBER' ? access.linkedMemberId : null;
  const isArchived = group.status === 'ARCHIVED';
  const canWrite = !isArchived && access.canWriteExpense;
  const canMarkPaid = access.canWriteExpense;
  const openExpenseCount = expenses.filter(
    (expense) => !expense.lockedBySettlementId && !expense.isDraft,
  ).length;
  const draftExpenseCount = expenses.filter(
    (expense) => !expense.lockedBySettlementId && expense.isDraft,
  ).length;
  const draftsForCaller: DraftRow[] = expenses
    .filter(
      (expense) =>
        expense.isDraft &&
        !expense.lockedBySettlementId &&
        (boundMemberId === null || expense.payerMemberId === boundMemberId) &&
        canWrite,
    )
    .map((expense) => ({
      expenseId: expense.id,
      title: expense.title,
      occurredAt: expense.occurredAt,
      currency: expense.currency,
      payerName: memberById.get(expense.payerMemberId)?.displayName ?? '?',
    }));
  const expensePage = getPageSlice(
    expenses,
    searchParams.get('ep') ?? undefined,
    PAGE_SIZE_EXPENSES,
  );
  const membersPage = getPageSlice(members, searchParams.get('mp') ?? undefined, PAGE_SIZE_MEMBERS);
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
  const ownerCandidates: OwnerCandidate[] =
    isOwner && !isSuperAdminBypass
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
    <section className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-5 px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-9">
      <GroupLiveRefresher groupId={groupId} />
      <LedgerPageHeader
        name={group.name}
        currency={group.defaultCurrency}
        members={members}
        archived={isArchived}
        overflowActions={
          (access.canSettle && !isArchived) ||
          (canManage && access.kind === 'user') ||
          access.kind === 'user' ? (
            <>
              {access.canSettle && !isArchived ? (
                <SettleButton
                  groupId={groupId}
                  openExpenseCount={openExpenseCount}
                  draftExpenseCount={draftExpenseCount}
                />
              ) : null}
              {canManage && access.kind === 'user' ? (
                <GroupShareDialog
                  groupId={groupId}
                  existingLinks={existingShareLinks.filter((link) => link.memberId === null)}
                  baseUrl={window.location.origin}
                />
              ) : null}
              {access.kind === 'user' ? <ExportMenu groupId={groupId} /> : null}
            </>
          ) : undefined
        }
      />

      {isSuperAdminBypass ? (
        <p className="border-destructive/40 bg-destructive/10 text-destructive-ink rounded-lg border px-4 py-3 text-sm font-medium">
          {t('admin.bypass_banner')}
        </p>
      ) : null}
      {isArchived ? (
        <p className="bg-secondary text-secondary-foreground rounded-lg border px-4 py-3 text-sm">
          {t('groups.archived_banner')}
        </p>
      ) : null}

      <div>
        <Tabs
          defaultTab={isArchived ? 'settlement' : 'expenses'}
          hideTabListOnMobile
          hashAliases={{ summary: 'settlement', transfers: 'settlement' }}
          tabs={[
            {
              id: 'expenses',
              label: t('expenses.title'),
              badge: expenses.length,
              content: (
                <section className="flex min-w-0 flex-col gap-4">
                  {draftsForCaller.length > 0 ? (
                    <DraftFillPanel groupId={groupId} drafts={draftsForCaller} />
                  ) : null}
                  <ExpenseReceiptFeed
                    groupId={groupId}
                    expenses={expensePage.slice}
                    totalItems={expenses.length}
                    pageSize={PAGE_SIZE_EXPENSES}
                    members={members}
                    canWrite={canWrite}
                    boundMemberId={boundMemberId}
                    action={
                      canWrite ? (
                        <Button
                          asChild
                          size="sm"
                          className={access.kind === 'user' ? 'hidden md:inline-flex' : undefined}
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
                  <div className="bg-card rounded-xl border p-4 sm:p-5">
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
                  </div>
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
              id: 'settings',
              label: t('groups.settings'),
              content: (
                <section className="bg-card rounded-xl border p-4 sm:p-5">
                  <SettingsPanel
                    groupId={groupId}
                    members={members}
                    membersPage={membersPage}
                    isOwner={isOwner}
                    canManage={canManage}
                    canSettle={access.canSettle}
                    isArchived={isArchived}
                    settlementId={detail.data.latestSettlementId ?? undefined}
                    existingShareLinks={existingShareLinks.filter((link) => link.memberId !== null)}
                    pendingInvitations={pendingInvitations}
                    baseUrl={window.location.origin}
                    ownerCandidates={ownerCandidates}
                  />
                </section>
              ),
            },
          ]}
        />
      </div>
    </section>
  );
}
