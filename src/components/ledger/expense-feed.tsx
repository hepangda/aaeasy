import { useMemo, type ReactNode } from 'react';
import { EllipsisVertical, Pencil, ReceiptText, StickyNote } from 'lucide-react';
import { useLocale, useTranslations } from 'use-intl';
import Link from '@/router/link';
import {
  DeleteExpenseButton,
  DeleteExpenseMenuItem,
} from '@/components/expense/delete-expense-button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SplitBadge } from '@/components/expense/split-badge';
import { LedgerMemberAvatar } from '@/components/ledger/member-avatar';
import { Button } from '@/components/ui/button';
import { Pagination } from '@/components/ui/pagination';
import { Eyebrow } from '@/components/ui/eyebrow';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { formatMoney } from '@aaeasy/core/money';
import { splitInputStateSchema } from '@aaeasy/core/split-input-state';
import { classifyPersistedSplit } from '@/lib/split/intent';
import { splitRuleSchema } from '@aaeasy/core/split-types';
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
    <li className="group hover:bg-accent/35 flex items-center gap-3 px-5 py-3.5 transition-colors sm:px-6">
      {/* The payer's avatar replaces what used to be an identical icon on
          every single row — 36px of pure decoration. This carries real
          information (who paid) and doubles as the scanning anchor. */}
      {payer ? (
        <LedgerMemberAvatar member={payer} size="md" className="mt-0.5 shrink-0" />
      ) : (
        <span className="bg-muted text-muted-foreground mt-0.5 grid size-9 shrink-0 place-items-center rounded-full text-xs font-bold">
          ?
        </span>
      )}

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <h3 className="truncate text-sm font-semibold" title={expense.note ?? undefined}>
          {expense.title}
        </h3>

        {/* One quiet metadata line. Payer name, split summary and any status
            chips all sit at the same size and weight so none of them competes
            with the title above or the amount to the right. */}
        <div className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs">
          <span className="truncate">{payer?.displayName ?? '?'}</span>
          {!expense.isDraft ? (
            <>
              <span aria-hidden="true">·</span>
              <SplitBadge kind={kind} shares={splitShares(expense, members, locale)} />
            </>
          ) : null}
          {expense.isDraft ? (
            <Eyebrow as="span" variant="chip" tone="signal" mono className="shrink-0">
              {t('expenses.draft_badge')}
            </Eyebrow>
          ) : null}
          {expense.tags.length > 0 ? (
            <span className="truncate">· {expense.tags.join(' · ')}</span>
          ) : null}
          {expense.note ? (
            <StickyNote className="size-3 shrink-0" aria-label={t('expenses.note')} />
          ) : null}
        </div>
      </div>

      {/* The amount is the one thing a user scans a ledger for, so it gets the
          largest type on the row and is the only element allowed to be bold. */}
      <p className="shrink-0 font-mono text-lg font-bold tracking-[-0.04em] whitespace-nowrap tabular-nums">
        {expense.amountMinor === null
          ? '—'
          : formatMoney(expense.amountMinor, expense.currency, locale)}
      </p>

      {editable ? (
        <>
          {/* On touch widths the row stays clean: a single overflow trigger
              stands in for the actions, which only appear once it is tapped.
              A row of always-visible icon buttons costs horizontal space the
              title and amount need more. */}
          <div className="shrink-0 md:hidden">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" size="icon" variant="ghost" aria-label={t('common.actions')}>
                  <EllipsisVertical />
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
          </div>

          {/* From `md` up there is a pointer and room to spare, so the two
              actions sit directly on the row and recede until it is engaged. */}
          <div className="hidden shrink-0 items-center gap-0.5 opacity-60 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 md:flex">
            <Button asChild type="button" size="icon" variant="ghost">
              <Link
                href={`/groups/${groupId}/expenses/${expense.id}/edit`}
                aria-label={t('common.edit')}
              >
                <Pencil />
              </Link>
            </Button>
            <DeleteExpenseButton groupId={groupId} expenseId={expense.id} />
          </div>
        </>
      ) : null}
    </li>
  );
}

export function ExpenseFeed({
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
