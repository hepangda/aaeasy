import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { getTranslations, getFormatter, getLocale } from 'next-intl/server';
import { Plus, Pencil } from 'lucide-react';
import { prisma } from '@/lib/db';
import { AccessError, requireGroupAccess } from '@/lib/auth/group-access';
import { loadGroupLedger } from '@/lib/expenses/queries';
import { formatMoney, formatMinor } from '@/lib/money';
import { Button } from '@/components/ui/button';
import { DeleteExpenseButton } from '@/components/delete-expense-button';
import { DraftFillPanel, type DraftRow } from '@/components/draft-fill-panel';
import { GroupLiveRefresher } from '@/components/group-live-refresher';
import { ReceiptActionsButton } from '@/components/receipt-actions-button';
import { SettleButton } from '@/components/settle-button';
import { ReopenSettlementButton } from '@/components/reopen-settlement-button';
import { TransfersPanel } from '@/components/transfers-panel';
import { ExportMenu } from '@/components/export-menu';
import { SettingsPanel } from '@/components/settings-panel';
import type { ExistingShareLink } from '@/components/member-share-dialog';
import type { OwnerCandidate } from '@/components/transfer-ownership-button';
import { SplitBadge } from '@/components/split-badge';
import { Tabs } from '@/components/ui/tabs';
import { classifySplit } from '@/lib/split/classify';
import { splitRuleSchema } from '@/lib/split/types';
import { Pagination } from '@/components/ui/pagination';
import { getPageSlice } from '@/lib/pagination';

const PAGE_SIZE_EXPENSES = 10;
const PAGE_SIZE_MEMBERS = 12;

export default async function GroupPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ep?: string; mp?: string }>;
}) {
  const { id } = await params;
  const { ep, mp } = await searchParams;
  let access;
  try {
    access = await requireGroupAccess(id, 'READ_GROUP');
  } catch (e) {
    if (e instanceof AccessError) {
      if (e.code === 'NOT_FOUND') notFound();
      if (e.code === 'UNAUTHENTICATED') redirect(`/login?next=/groups/${id}`);
      notFound();
    }
    throw e;
  }

  const t = await getTranslations();
  const fmt = await getFormatter();
  const locale = await getLocale();

  const ledger = await loadGroupLedger(id);
  const { group, members, expenses, summary, transfers } = ledger;

  const memberById = new Map(members.map((m) => [m.id, m]));
  // ─── Capability flags ────────────────────────────────────────────────
  // Mirror of the server-side matrix in `requireGroupAccess` — used to
  // hide UI entry points for actions the caller couldn't perform anyway.
  const role = access.kind === 'user' ? access.role : null;
  const linkedMemberId =
    access.kind === 'user' ? access.linkedMemberId : null;
  const isOwner = role === 'OWNER';
  const canManage = role === 'OWNER' || role === 'MANAGER';
  // The member.id this caller's writes are constrained to (null = no
  // constraint, i.e. they can act on any member's behalf).
  const boundMemberId: string | null =
    access.kind === 'share'
      ? access.boundMemberId
      : role === 'MEMBER'
        ? linkedMemberId
        : null;
  const isArchived = group.status === 'ARCHIVED';
  const canWrite =
    !isArchived &&
    (canManage ||
      (role === 'MEMBER' && linkedMemberId !== null) ||
      (access.kind === 'share' && access.scope === 'WRITE') ||
      (access.kind === 'share' && access.boundMemberId !== null));
  const canMarkPaid =
    canManage ||
    (role === 'MEMBER' && linkedMemberId !== null) ||
    (access.kind === 'share' && access.scope === 'WRITE') ||
    (access.kind === 'share' && access.boundMemberId !== null);
  const openExpenseCount = expenses.filter(
    (e) => !e.lockedBySettlementId && !e.isDraft,
  ).length;
  const draftExpenseCount = expenses.filter(
    (e) => !e.lockedBySettlementId && e.isDraft,
  ).length;

  // Drafts the current caller is allowed to fill in. Bound writers (per-
  // member share visitor or signed-in MEMBER role) only see drafts where
  // they are the payer; managers/owners see every draft in the group.
  const draftsForCaller: DraftRow[] = expenses
    .filter(
      (e) =>
        e.isDraft &&
        !e.lockedBySettlementId &&
        (boundMemberId === null || e.payerMemberId === boundMemberId) &&
        canWrite,
    )
    .map((e) => ({
      expenseId: e.id,
      title: e.title,
      occurredAt: e.occurredAt,
      currency: e.currency,
      payerName: memberById.get(e.payerMemberId)?.displayName ?? '?',
    }));

  // ─── Pagination (server-side slicing) ─────────────────────────────────
  // Tab state lives in the URL hash; pagination lives in search params so
  // the two are orthogonal and back/forward works naturally.
  const expensesPage = getPageSlice(expenses, ep, PAGE_SIZE_EXPENSES);
  const membersPage = getPageSlice(members, mp, PAGE_SIZE_MEMBERS);

  // When archived, the latest settlement anchors the lock and is the target
  // of the Reopen button. We don't need its snapshot any more — the live
  // ledger drives the transfers panel.
  const latestSettlement = isArchived
    ? await prisma.settlement.findFirst({
        where: { groupId: id },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      })
    : null;

  // Used by the per-member share UI to render absolute URLs.
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? (await deriveBaseUrlFromHeaders());

  // Existing per-member share links — only relevant to managers, who are
  // the only roles that can create or revoke them.
  const existingShareLinks: ExistingShareLink[] = canManage
    ? (
        await prisma.shareLink.findMany({
          where: { groupId: id, memberId: { not: null } },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            memberId: true,
            label: true,
            scope: true,
            createdAt: true,
            expiresAt: true,
            revokedAt: true,
          },
        })
      ).map((l) => {
        const expired =
          l.expiresAt !== null && l.expiresAt <= new Date();
        return {
          id: l.id,
          memberId: l.memberId,
          label: l.label,
          scope: l.scope,
          createdAt: fmt.dateTime(l.createdAt, 'short'),
          expiresAt: l.expiresAt ? fmt.dateTime(l.expiresAt, 'short') : null,
          expired,
          revoked: l.revokedAt !== null,
        };
      })
    : [];

  // Eligible OWNER-transfer candidates: every linked member of the group
  // whose linked user isn't already the OWNER (i.e. self). Only computed
  // for OWNER, since they're the only role that sees the button.
  const selfUserId = access.kind === 'user' ? access.userId : null;
  const ownerCandidates: OwnerCandidate[] = isOwner
    ? members
        .filter(
          (m) =>
            m.linkedUserId !== null &&
            m.linkedUserId !== selfUserId &&
            m.linkedUsername !== null,
        )
        .map((m) => ({
          userId: m.linkedUserId as string,
          label: `${m.displayName} (@${m.linkedUsername})`,
        }))
    : [];

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-6 py-10">
      <GroupLiveRefresher groupId={id} />
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">{group.name}</h1>
            {isArchived && (
              <span className="bg-secondary text-secondary-foreground inline-flex rounded px-2 py-0.5 text-xs font-medium uppercase tracking-wide">
                {t('expenses.locked_badge')}
              </span>
            )}
          </div>
          <p className="text-muted-foreground text-sm">{group.defaultCurrency}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canWrite && (
            <Button asChild>
              <Link href={`/groups/${id}/expenses/new`}>
                <Plus /> {t('expenses.add')}
              </Link>
            </Button>
          )}
          {canManage && !isArchived && (
            <SettleButton
              groupId={id}
              openExpenseCount={openExpenseCount}
              draftExpenseCount={draftExpenseCount}
            />
          )}
          {access.kind === 'user' && <ExportMenu groupId={id} />}
        </div>
      </header>

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
                  <DraftFillPanel groupId={id} drafts={draftsForCaller} />
                )}
                {expenses.length === 0 ? (
                  <p className="text-muted-foreground rounded-md border border-dashed px-4 py-8 text-center text-sm">
                    {t('expenses.empty')}
                  </p>
                ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[720px] text-sm">
              <colgroup>
                <col className="w-[88px]" />
                <col className="w-[28%]" />
                <col className="w-[80px]" />
                <col className="w-[110px]" />
                <col />
                <col className="w-[88px]" />
              </colgroup>
              <thead className="bg-muted/40 text-muted-foreground text-xs uppercase tracking-wide">
                <tr>
                  <th className="px-3 py-2.5 text-left font-medium">{t('expenses.date')}</th>
                  <th className="px-3 py-2.5 text-left font-medium">
                    {t('expenses.title_field')}
                  </th>
                  <th className="px-3 py-2.5 text-left font-medium">{t('expenses.payer')}</th>
                  <th className="px-3 py-2.5 text-right font-medium">{t('expenses.amount')}</th>
                  <th className="px-3 py-2.5 text-left font-medium">
                    {t('expenses.split_rule')}
                  </th>
                  <th className="px-3 py-2.5 text-right font-medium">
                    {t('common.actions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {expensesPage.slice.map((e) => {
                  const payer = memberById.get(e.payerMemberId);
                  return (
                    <tr key={e.id} className="border-t align-middle">
                      <td className="text-muted-foreground px-3 py-3 align-middle whitespace-nowrap tabular-nums">
                        {fmt.dateTime(e.occurredAt, 'short')}
                      </td>
                      <td className="px-3 py-3 align-middle">
                        <div className="flex flex-col gap-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="font-medium leading-tight">{e.title}</span>
                            {e.isDraft && (
                              <span className="bg-amber-500/15 text-amber-700 dark:text-amber-400 inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide">
                                {t('expenses.draft_badge')}
                              </span>
                            )}
                            {e.tags.map((tag) => (
                              <span
                                key={tag}
                                className="bg-accent text-accent-foreground inline-flex rounded px-1.5 py-0.5 text-[10px]"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                          {e.note && (
                            <span className="text-muted-foreground text-xs leading-snug">
                              {e.note}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3 align-middle whitespace-nowrap">
                        {payer?.displayName ?? '?'}
                      </td>
                      <td className="px-3 py-3 text-right font-mono align-middle whitespace-nowrap tabular-nums">
                        {e.amountMinor != null
                          ? formatMoney(e.amountMinor, e.currency, locale)
                          : (
                            <span className="text-muted-foreground">—</span>
                          )}
                      </td>
                      <td className="px-3 py-3 align-middle">
                        {(() => {
                          const parsedRule = splitRuleSchema.safeParse(e.splitRule);
                          const kind = classifySplit({
                            splits: e.splits,
                            splitRule: parsedRule.success ? parsedRule.data : null,
                          });
                          const shares = members
                            .map((m) => {
                              const v =
                                e.splits.find((s) => s.memberId === m.id)?.shareMinor ?? 0n;
                              return {
                                memberId: m.id,
                                memberName: m.displayName,
                                amountText: formatMoney(v, e.currency, locale),
                                isPayer: e.payerMemberId === m.id,
                                shareMinor: v,
                              };
                            })
                            .filter((s) => s.shareMinor > 0n)
                            .map(({ shareMinor: _, ...rest }) => {
                              void _;
                              return rest;
                            });
                          return <SplitBadge kind={kind} shares={shares} />;
                        })()}
                      </td>
                      <td className="px-3 py-3 align-middle">
                        <div className="flex min-h-8 items-center justify-end gap-0.5">
                          {(() => {
                            // Bound share visitors can only modify expenses
                            // they paid for; same constraint hides the controls.
                            const isMine =
                              boundMemberId === null ||
                              e.payerMemberId === boundMemberId;
                            const editable =
                              canWrite && !e.lockedBySettlementId && isMine;
                            return (
                              <>
                                <ReceiptActionsButton
                                  groupId={id}
                                  expenseId={e.id}
                                  receipts={e.receipts}
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
                                      <Link href={`/groups/${id}/expenses/${e.id}/edit`}>
                                        <Pencil />
                                      </Link>
                                    </Button>
                                    <DeleteExpenseButton groupId={id} expenseId={e.id} />
                                  </>
                                )}
                              </>
                            );
                          })()}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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
              <section className="flex flex-col gap-3">
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
              {summary.map((s) => {
                const m = memberById.get(s.memberId)!;
                const toneFor = (v: bigint) =>
                  v > 0n
                    ? 'text-emerald-600'
                    : v < 0n
                      ? 'text-destructive'
                      : 'text-muted-foreground';
                return (
                  <tr key={s.memberId} className="border-t">
                    <td className="px-3 py-2 font-medium">{m.displayName}</td>
                    <td className="px-3 py-2 text-right font-mono">
                      {formatMoney(s.paidMinorInGroup, group.defaultCurrency, locale)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {formatMoney(s.owedMinorInGroup, group.defaultCurrency, locale)}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-mono ${toneFor(s.netMinorInGroup)}`}
                    >
                      {formatMoney(s.netMinorInGroup, group.defaultCurrency, locale)}
                    </td>
                    {ledger.settlementEntries.length > 0 && (
                      <td
                        className={`px-3 py-2 text-right font-mono ${toneFor(s.adjustedNetMinorInGroup)}`}
                      >
                        {formatMoney(
                          s.adjustedNetMinorInGroup,
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
              </section>
            ),
          },
          {
            id: 'transfers',
            label: t('summary.transfers_title'),
            badge: transfers.length || undefined,
            content: (
              <TransfersPanel
                groupId={id}
                members={members.map((m) => ({ id: m.id, displayName: m.displayName }))}
                defaultCurrency={group.defaultCurrency}
                canEdit={canMarkPaid}
                boundMemberId={boundMemberId}
                suggested={transfers.map((tr) => ({
                  fromMemberId: tr.from,
                  toMemberId: tr.to,
                  fromName: memberById.get(tr.from)?.displayName ?? '?',
                  toName: memberById.get(tr.to)?.displayName ?? '?',
                  amountText: formatMoney(tr.amountMinor, group.defaultCurrency, locale),
                  amountMajor: formatMinor(tr.amountMinor, group.defaultCurrency),
                }))}
                executed={ledger.settlementEntries.map((e) => ({
                  id: e.id,
                  fromMemberId: e.fromMemberId,
                  toMemberId: e.toMemberId,
                  fromName: memberById.get(e.fromMemberId)?.displayName ?? '?',
                  toName: memberById.get(e.toMemberId)?.displayName ?? '?',
                  amountText: formatMoney(e.amountMinor, group.defaultCurrency, locale),
                  occurredAt: fmt.dateTime(e.occurredAt, 'short'),
                  note: e.note,
                  createdByName: e.createdByName,
                }))}
              />
            ),
          },
          {
            id: 'settings',
            label: t('groups.settings'),
            content: (
              <SettingsPanel
                groupId={id}
                members={members}
                membersPage={membersPage}
                isOwner={isOwner}
                canManage={canManage}
                isArchived={isArchived}
                settlementId={latestSettlement?.id}
                existingShareLinks={existingShareLinks}
                baseUrl={baseUrl}
                ownerCandidates={ownerCandidates}
              />
            ),
          },
        ]}
      />
    </section>
  );
}

async function deriveBaseUrlFromHeaders(): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? 'http';
  return `${proto}://${host}`;
}
