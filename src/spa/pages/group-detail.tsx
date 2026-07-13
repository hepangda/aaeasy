import Link from '@/compat/link';
import { Navigate, useParams, useSearchParams } from 'react-router';
import { useFormatter, useLocale, useTranslations } from 'use-intl';
import { Pencil, Plus } from 'lucide-react';
import { DeleteExpenseButton } from '@/components/expense/delete-expense-button';
import { DraftFillPanel, type DraftRow } from '@/components/expense/draft-fill-panel';
import { ReceiptActionsButton } from '@/components/expense/receipt-actions-button';
import { SplitBadge } from '@/components/expense/split-badge';
import { GroupLiveRefresher } from '@/components/group/group-live-refresher';
import { SettingsPanel } from '@/components/group/settings-panel';
import type { OwnerCandidate } from '@/components/group/transfer-ownership-button';
import { ExportMenu } from '@/components/settle/export-menu';
import { SettleButton } from '@/components/settle/settle-button';
import { TransfersPanel } from '@/components/settle/transfers-panel';
import { GroupShareDialog } from '@/components/share/group-share-dialog';
import type { ExistingShareLink } from '@/components/share/types';
import { Button } from '@/components/ui/button';
import { Pagination } from '@/components/ui/pagination';
import { Tabs } from '@/components/ui/tabs';
import { formatMinor, formatMoney } from '@/lib/money';
import { getPageSlice } from '@/lib/pagination';
import { classifySplit } from '@/lib/split/classify';
import { splitRuleSchema } from '@/lib/split/types';
import { ErrorPage, LoadingPage } from '../page-state';
import { useGroupQuery, useLedgerQuery } from '../queries';
import type { LedgerExpense } from '../types';

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

  if (detail.isPending || ledgerQuery.isPending) return <LoadingPage />;
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

  function splitBadge(expense: LedgerExpense) {
    const parsed = splitRuleSchema.safeParse(expense.splitRule);
    const kind = classifySplit({
      splits: expense.splits,
      splitRule: parsed.success ? parsed.data : null,
    });
    return (
      <SplitBadge
        kind={kind}
        shares={members.flatMap((member) => {
          const shareMinor =
            expense.splits.find((split) => split.memberId === member.id)?.shareMinor ?? 0n;
          return shareMinor > 0n
            ? [
                {
                  memberId: member.id,
                  memberName: member.displayName,
                  amountText: formatMoney(shareMinor, expense.currency, locale),
                  isPayer: expense.payerMemberId === member.id,
                },
              ]
            : [];
        })}
      />
    );
  }

  function expenseActions(expense: LedgerExpense) {
    const editable =
      canWrite &&
      !expense.lockedBySettlementId &&
      (boundMemberId === null || expense.payerMemberId === boundMemberId);
    return (
      <div className="flex min-h-8 items-center justify-end gap-0.5">
        <ReceiptActionsButton
          groupId={groupId}
          expenseId={expense.id}
          receipts={expense.receipts}
          canEdit={editable}
        />
        {editable && (
          <>
            <Button
              asChild
              size="icon"
              variant="ghost"
              className="size-8"
              aria-label={t('common.edit')}
            >
              <Link href={`/groups/${groupId}/expenses/${expense.id}/edit`}>
                <Pencil />
              </Link>
            </Button>
            <DeleteExpenseButton groupId={groupId} expenseId={expense.id} />
          </>
        )}
      </div>
    );
  }

  return (
    <section className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6 sm:gap-10 sm:px-6 sm:py-10 lg:px-8">
      <GroupLiveRefresher groupId={groupId} />
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{group.name}</h1>
            {isArchived && (
              <span className="bg-secondary text-secondary-foreground rounded px-2 py-0.5 text-xs font-medium tracking-wide uppercase">
                {t('expenses.locked_badge')}
              </span>
            )}
          </div>
          <p className="text-muted-foreground text-sm">{group.defaultCurrency}</p>
        </div>
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:justify-end [&>a]:w-full sm:[&>a]:w-auto [&>button]:w-full sm:[&>button]:w-auto">
          {canWrite && (
            <Button asChild>
              <Link href={`/groups/${groupId}/expenses/new`}>
                <Plus /> {t('expenses.add')}
              </Link>
            </Button>
          )}
          {access.canSettle && !isArchived && (
            <SettleButton
              groupId={groupId}
              openExpenseCount={openExpenseCount}
              draftExpenseCount={draftExpenseCount}
            />
          )}
          {canManage && access.kind === 'user' && (
            <GroupShareDialog
              groupId={groupId}
              existingLinks={existingShareLinks.filter((link) => link.memberId === null)}
              baseUrl={window.location.origin}
            />
          )}
          {access.kind === 'user' && <ExportMenu groupId={groupId} />}
        </div>
      </header>

      {isSuperAdminBypass && (
        <p className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border px-4 py-3 text-sm font-medium">
          {t('admin.bypass_banner')}
        </p>
      )}
      {isArchived && (
        <p className="bg-secondary text-secondary-foreground rounded-md border px-4 py-3 text-sm">
          {t('groups.archived_banner')}
        </p>
      )}

      <Tabs
        defaultTab={isArchived ? 'transfers' : 'expenses'}
        tabs={[
          {
            id: 'expenses',
            label: t('expenses.title'),
            badge: expenses.length,
            content: (
              <section className="flex flex-col gap-3">
                {draftsForCaller.length > 0 && (
                  <DraftFillPanel groupId={groupId} drafts={draftsForCaller} />
                )}
                {expenses.length === 0 ? (
                  <p className="text-muted-foreground rounded-md border border-dashed px-4 py-8 text-center text-sm">
                    {t('expenses.empty')}
                  </p>
                ) : (
                  <ul className="grid gap-3">
                    {expensePage.slice.map((expense) => (
                      <li key={expense.id} className="bg-card rounded-md border p-3 text-sm sm:p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium">{expense.title}</span>
                              {expense.isDraft && (
                                <span className="inline-flex rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-amber-700 uppercase dark:text-amber-400">
                                  {t('expenses.draft_badge')}
                                </span>
                              )}
                              {expense.tags.map((tag) => (
                                <span
                                  key={tag}
                                  className="bg-accent rounded px-1.5 py-0.5 text-[10px]"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                            {expense.note && (
                              <p className="text-muted-foreground mt-1 text-xs">{expense.note}</p>
                            )}
                          </div>
                          {expenseActions(expense)}
                        </div>
                        <dl className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                          <div>
                            <dt className="text-muted-foreground">{t('expenses.date')}</dt>
                            <dd>{fmt.dateTime(expense.occurredAt, 'short')}</dd>
                          </div>
                          <div>
                            <dt className="text-muted-foreground">{t('expenses.payer')}</dt>
                            <dd>{memberById.get(expense.payerMemberId)?.displayName ?? '?'}</dd>
                          </div>
                          <div>
                            <dt className="text-muted-foreground">{t('expenses.amount')}</dt>
                            <dd className="font-mono tabular-nums">
                              {expense.amountMinor === null
                                ? '—'
                                : formatMoney(expense.amountMinor, expense.currency, locale)}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-muted-foreground">{t('expenses.split_rule')}</dt>
                            <dd>{splitBadge(expense)}</dd>
                          </div>
                        </dl>
                      </li>
                    ))}
                  </ul>
                )}
                <Pagination
                  paramKey="ep"
                  totalItems={expenses.length}
                  pageSize={PAGE_SIZE_EXPENSES}
                />
              </section>
            ),
          },
          {
            id: 'summary',
            label: t('summary.title'),
            content: (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">{t('summary.member')}</th>
                      <th className="px-3 py-2 text-right font-medium">{t('summary.paid')}</th>
                      <th className="px-3 py-2 text-right font-medium">{t('summary.owed')}</th>
                      <th className="px-3 py-2 text-right font-medium">
                        {ledger.settlementEntries.length > 0
                          ? t('settlements.before')
                          : t('summary.net')}
                      </th>
                      {ledger.settlementEntries.length > 0 && (
                        <th className="px-3 py-2 text-right font-medium">
                          {t('settlements.current')}
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {summary.map((row) => {
                      const tone = (value: bigint) =>
                        value > 0n
                          ? 'text-emerald-600'
                          : value < 0n
                            ? 'text-destructive'
                            : 'text-muted-foreground';
                      return (
                        <tr key={row.memberId} className="border-t">
                          <td className="px-3 py-2 font-medium">
                            {memberById.get(row.memberId)?.displayName ?? '?'}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">
                            {formatMoney(row.paidMinorInGroup, group.defaultCurrency, locale)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">
                            {formatMoney(row.owedMinorInGroup, group.defaultCurrency, locale)}
                          </td>
                          <td
                            className={`px-3 py-2 text-right font-mono ${tone(row.netMinorInGroup)}`}
                          >
                            {formatMoney(row.netMinorInGroup, group.defaultCurrency, locale)}
                          </td>
                          {ledger.settlementEntries.length > 0 && (
                            <td
                              className={`px-3 py-2 text-right font-mono ${tone(row.adjustedNetMinorInGroup)}`}
                            >
                              {formatMoney(
                                row.adjustedNetMinorInGroup,
                                group.defaultCurrency,
                                locale,
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ),
          },
          {
            id: 'transfers',
            label: t('summary.transfers_title'),
            badge: transfers.length || undefined,
            content: (
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
                  amountText: formatMoney(transfer.amountMinor, group.defaultCurrency, locale),
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
            ),
          },
          {
            id: 'settings',
            label: t('groups.settings'),
            content: (
              <SettingsPanel
                groupId={groupId}
                members={members}
                membersPage={membersPage}
                isOwner={isOwner}
                canManage={canManage}
                isArchived={isArchived}
                settlementId={detail.data.latestSettlementId ?? undefined}
                existingShareLinks={existingShareLinks.filter((link) => link.memberId !== null)}
                pendingInvitations={pendingInvitations}
                baseUrl={window.location.origin}
                ownerCandidates={ownerCandidates}
              />
            ),
          },
        ]}
      />
    </section>
  );
}
