import { useMemo, type ReactNode } from 'react';
import { MoreHorizontal, Pencil, ReceiptText } from 'lucide-react';
import { useLocale, useTranslations } from 'use-intl';
import Link from '@/compat/link';
import { DeleteExpenseMenuItem } from '@/components/expense/delete-expense-button';
import { ReceiptActionsButton } from '@/components/expense/receipt-actions-button';
import { SplitBadge } from '@/components/expense/split-badge';
import { LedgerMemberAvatar } from '@/components/ledger/member-avatar';
import { Button } from '@/components/ui/button';
import { Pagination } from '@/components/ui/pagination';
import { Eyebrow } from '@/components/ui/eyebrow';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatMoney } from '@/lib/money';
import { splitInputStateSchema } from '@/lib/split/input-state';
import { classifyPersistedSplit } from '@/lib/split/intent';
import { splitRuleSchema } from '@/lib/split/types';
import type { LedgerExpense, LedgerMember } from '@/spa/types';

interface DateGroup {
  key: string;
  label: string;
  expenses: LedgerExpense[];
}

function localDateKey(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function groupByDate(expenses: LedgerExpense[], formatter: Intl.DateTimeFormat): DateGroup[] {
  const groups = new Map<string, DateGroup>();
  for (const expense of expenses) {
    const key = localDateKey(expense.occurredAt);
    const existing = groups.get(key);
    if (existing) {
      existing.expenses.push(expense);
      continue;
    }
    groups.set(key, {
      key,
      label: formatter.format(expense.occurredAt),
      expenses: [expense],
    });
  }
  return [...groups.values()];
}

function splitShares(expense: LedgerExpense, members: LedgerMember[], locale: string) {
  return members.flatMap((member) => {
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
  });
}

function ExpenseFeedItem({
  expense,
  groupId,
  members,
  memberById,
  canWrite,
  boundMemberId,
  locale,
}: {
  expense: LedgerExpense;
  groupId: string;
  members: LedgerMember[];
  memberById: Map<string, LedgerMember>;
  canWrite: boolean;
  boundMemberId: string | null;
  locale: string;
}) {
  const t = useTranslations();
  const payer = memberById.get(expense.payerMemberId);
  const editable =
    canWrite &&
    !expense.lockedBySettlementId &&
    (boundMemberId === null || expense.payerMemberId === boundMemberId);
  const parsed = splitRuleSchema.safeParse(expense.splitRule);
  const parsedInputState = splitInputStateSchema.safeParse(expense.splitInputState);
  const kind = classifyPersistedSplit({
    splits: expense.splits,
    splitRule: parsed.success ? parsed.data : null,
    splitInputState: parsedInputState.success ? parsedInputState.data : null,
  });

  return (
    <li className="group hover:bg-accent/35 flex gap-3 px-5 py-4 transition-colors sm:px-6">
      <span className="bg-primary/7 text-primary-ink border-primary/12 mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg border">
        <ReceiptText className="size-4" aria-hidden="true" />
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {/* Title and amount share a row so the amount stays adjacent to what it
            describes. The old layout reserved a fixed 6.75rem column for the
            amount plus actions, which ate 156px of a 375px viewport before the
            title got any space at all. */}
        <div className="flex items-start justify-between gap-3">
          <h3 className="min-w-0 flex-1 truncate text-sm font-semibold sm:text-base">
            {expense.title}
          </h3>
          <p className="font-mono text-base font-bold tracking-[-0.04em] whitespace-nowrap tabular-nums">
            {expense.amountMinor === null
              ? '—'
              : formatMoney(expense.amountMinor, expense.currency, locale)}
          </p>
        </div>

        <div className="text-muted-foreground flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          {payer ? <LedgerMemberAvatar member={payer} size="sm" className="size-5" /> : null}
          <span className="truncate">
            {t('expenses.payer')}: {payer?.displayName ?? '?'}
          </span>
          {!expense.isDraft ? (
            <SplitBadge kind={kind} shares={splitShares(expense, members, locale)} />
          ) : null}
          {expense.isDraft ? (
            <Eyebrow as="span" variant="chip" tone="signal" mono>
              {t('expenses.draft_badge')}
            </Eyebrow>
          ) : null}
          {expense.tags.map((tag) => (
            <Eyebrow key={tag} as="span" variant="chip" tone="secondary">
              {tag}
            </Eyebrow>
          ))}
        </div>

        {expense.note ? (
          <p className="text-muted-foreground line-clamp-2 text-xs leading-relaxed">
            {expense.note}
          </p>
        ) : null}
      </div>

      {/* Actions live in an overflow menu rather than three adjacent 32px
          buttons spaced 2px apart — with delete on the outside edge, that was a
          reliable mis-tap on touch. */}
      <div className="flex shrink-0 items-start gap-0.5">
        <ReceiptActionsButton
          groupId={groupId}
          expenseId={expense.id}
          receipts={expense.receipts}
          canEdit={editable}
        />
        {editable ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" size="icon" variant="ghost" aria-label={t('common.actions')}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild className="gap-2">
                <Link href={`/groups/${groupId}/expenses/${expense.id}/edit`}>
                  <Pencil className="size-4" aria-hidden="true" />
                  {t('common.edit')}
                </Link>
              </DropdownMenuItem>
              <DeleteExpenseMenuItem groupId={groupId} expenseId={expense.id} />
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </li>
  );
}

export function ExpenseReceiptFeed({
  groupId,
  expenses,
  totalItems,
  pageSize,
  members,
  canWrite,
  boundMemberId,
  action,
}: {
  groupId: string;
  expenses: LedgerExpense[];
  totalItems: number;
  pageSize: number;
  members: LedgerMember[];
  canWrite: boolean;
  boundMemberId: string | null;
  action?: ReactNode;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        weekday: 'short',
      }),
    [locale],
  );
  const dateGroups = useMemo(() => groupByDate(expenses, dateFormatter), [dateFormatter, expenses]);
  const memberById = useMemo(
    () => new Map(members.map((member) => [member.id, member])),
    [members],
  );

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-2.5">
              {t('expenses.title')}
              <Eyebrow as="span" variant="chip" tone="secondary" mono>
                {totalItems}
              </Eyebrow>
            </span>
          }
          action={action}
        />

        {expenses.length === 0 ? (
          <EmptyState compact icon={<ReceiptText />} title={t('expenses.empty')} />
        ) : (
          dateGroups.map((dateGroup) => (
            <section key={dateGroup.key} aria-labelledby={`expense-date-${dateGroup.key}`}>
              <Eyebrow
                as="h3"
                id={`expense-date-${dateGroup.key}`}
                mono
                className="bg-muted/55 border-border border-b px-5 py-2 sm:px-6"
              >
                {dateGroup.label}
              </Eyebrow>
              <ul className="divide-border divide-y">
                {dateGroup.expenses.map((expense) => (
                  <ExpenseFeedItem
                    key={expense.id}
                    expense={expense}
                    groupId={groupId}
                    members={members}
                    memberById={memberById}
                    canWrite={canWrite}
                    boundMemberId={boundMemberId}
                    locale={locale}
                  />
                ))}
              </ul>
            </section>
          ))
        )}
      </Card>

      {totalItems > pageSize ? (
        <Pagination paramKey="ep" totalItems={totalItems} pageSize={pageSize} />
      ) : null}
    </div>
  );
}
