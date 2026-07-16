import { useMemo, type ReactNode } from 'react';
import { Pencil, ReceiptText } from 'lucide-react';
import { useLocale, useTranslations } from 'use-intl';
import Link from '@/compat/link';
import { DeleteExpenseButton } from '@/components/expense/delete-expense-button';
import { ReceiptActionsButton } from '@/components/expense/receipt-actions-button';
import { SplitBadge } from '@/components/expense/split-badge';
import { LedgerMemberAvatar } from '@/components/ledger/member-avatar';
import { Button } from '@/components/ui/button';
import { Pagination } from '@/components/ui/pagination';
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
    <li className="group hover:bg-muted/25 grid grid-cols-[minmax(0,1fr)_auto] gap-4 px-4 py-4 transition-colors sm:px-5 sm:py-5">
      <div className="flex min-w-0 gap-3">
        <span className="bg-primary/7 text-primary-ink border-primary/10 mt-0.5 grid size-10 shrink-0 place-items-center rounded-xl border">
          <ReceiptText className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold sm:text-base">{expense.title}</h3>
            {expense.isDraft ? (
              <span className="bg-signal/20 text-signal-foreground dark:text-signal inline-flex rounded-full px-2 py-0.5 text-[9px] font-semibold tracking-[0.12em] uppercase">
                {t('expenses.draft_badge')}
              </span>
            ) : null}
            {expense.tags.map((tag) => (
              <span key={tag} className="bg-accent rounded-full px-2 py-0.5 text-[10px]">
                {tag}
              </span>
            ))}
          </div>

          <div className="text-muted-foreground mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            {payer ? (
              <LedgerMemberAvatar member={payer} size="sm" className="size-5 border-0 text-[8px]" />
            ) : null}
            <span className="truncate">
              {t('expenses.payer')}: {payer?.displayName ?? '?'}
            </span>
            {!expense.isDraft ? (
              <>
                <span aria-hidden className="hidden sm:inline">
                  ·
                </span>
                <SplitBadge kind={kind} shares={splitShares(expense, members, locale)} />
              </>
            ) : null}
          </div>

          {expense.note ? (
            <p className="text-muted-foreground mt-2 line-clamp-2 text-xs leading-relaxed">
              {expense.note}
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex min-w-[6.75rem] flex-col items-end justify-between gap-2 text-right">
        <div>
          <p className="font-mono text-base font-semibold tracking-[-0.025em] tabular-nums sm:text-lg">
            {expense.amountMinor === null
              ? '—'
              : formatMoney(expense.amountMinor, expense.currency, locale)}
          </p>
        </div>

        <div className="flex min-h-8 items-center justify-end gap-0.5">
          <ReceiptActionsButton
            groupId={groupId}
            expenseId={expense.id}
            receipts={expense.receipts}
            canEdit={editable}
          />
          {editable ? (
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
          ) : null}
        </div>
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
      <section className="bg-card shadow-soft overflow-hidden rounded-2xl border">
        <header className="flex items-center justify-between border-b px-4 py-4 sm:px-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <h2 className="text-lg font-semibold tracking-[-0.02em]">{t('expenses.title')}</h2>
            <span className="bg-muted text-muted-foreground rounded-full px-2.5 py-1 text-xs font-medium tabular-nums">
              {totalItems}
            </span>
          </div>
          {action}
        </header>

        {expenses.length === 0 ? (
          <div className="flex min-h-48 flex-col items-center justify-center px-6 text-center">
            <span className="bg-muted text-muted-foreground grid size-11 place-items-center rounded-full">
              <ReceiptText className="size-5" />
            </span>
            <p className="text-muted-foreground mt-3 max-w-sm text-sm">{t('expenses.empty')}</p>
          </div>
        ) : (
          dateGroups.map((dateGroup) => (
            <section key={dateGroup.key} aria-labelledby={`expense-date-${dateGroup.key}`}>
              <h3
                id={`expense-date-${dateGroup.key}`}
                className="bg-muted/45 text-muted-foreground border-b px-4 py-2 text-[10px] font-semibold tracking-[0.12em] uppercase sm:px-5"
              >
                {dateGroup.label}
              </h3>
              <ul className="divide-y">
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
      </section>

      {totalItems > pageSize ? (
        <Pagination paramKey="ep" totalItems={totalItems} pageSize={pageSize} />
      ) : null}
    </div>
  );
}
