import Link from '@/compat/link';
import { useQuery } from '@tanstack/react-query';
import { Navigate, useParams } from 'react-router';
import { useTranslations } from 'use-intl';
import { ChevronLeft } from 'lucide-react';
import { ExpenseForm } from '@/components/expense/expense-form';
import { Button } from '@/components/ui/button';
import { formatMinor } from '@/lib/money';
import { splitInputStateSchema, type SplitInputState } from '@/lib/split/input-state';
import { splitRuleSchema, type SplitRule } from '@/lib/split/types';
import { apiRequest } from '../api';
import { ErrorPage, LoadingPage } from '../page-state';
import { useGroupQuery } from '../queries';
import type { ExpenseResponse } from '../types';

function status(error: unknown): number | undefined {
  return error && typeof error === 'object' && 'status' in error ? Number(error.status) : undefined;
}

function constrainedPayer(access: {
  kind: 'user' | 'share';
  role: string | null;
  linkedMemberId: string | null;
}) {
  return access.kind === 'share' || access.role === 'MEMBER'
    ? (access.linkedMemberId ?? undefined)
    : undefined;
}

export function NewExpensePage() {
  const groupId = useParams<{ groupId: string }>().groupId ?? '';
  const t = useTranslations();
  const detail = useGroupQuery(groupId);
  if (detail.isPending) return <LoadingPage />;
  if (status(detail.error) === 401) {
    return (
      <Navigate
        to={`/login?next=${encodeURIComponent(`/groups/${groupId}/expenses/new`)}`}
        replace
      />
    );
  }
  if (detail.isError) return <ErrorPage error={detail.error} />;
  if (!detail.data.access.canWriteExpense || detail.data.group.status === 'ARCHIVED') {
    return <ErrorPage error={{ status: 403 }} />;
  }
  const members = detail.data.members.map((member) => ({
    id: member.id,
    displayName: member.displayName,
  }));
  return (
    <section className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-5 px-4 py-5 sm:gap-7 sm:px-6 sm:py-10 lg:px-8">
      <Button asChild variant="ghost" size="sm" className="-ml-2 self-start">
        <Link href={`/groups/${groupId}`}>
          <ChevronLeft /> {detail.data.group.name}
        </Link>
      </Button>
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-3xl leading-none font-bold tracking-[-0.055em] sm:text-4xl">
          {t('expenses.add')}
        </h1>
        <p className="text-muted-foreground max-w-xl text-sm leading-relaxed">
          {t('expenses.form_intro')}
        </p>
      </header>
      <ExpenseForm
        groupId={groupId}
        groupCurrency={detail.data.group.defaultCurrency}
        members={members}
        lockedPayerMemberId={constrainedPayer(detail.data.access)}
      />
    </section>
  );
}

export function EditExpensePage() {
  const params = useParams<{ groupId: string; expenseId: string }>();
  const groupId = params.groupId ?? '';
  const expenseId = params.expenseId ?? '';
  const t = useTranslations();
  const detail = useGroupQuery(groupId);
  const expenseQuery = useQuery({
    queryKey: ['expense', groupId, expenseId],
    queryFn: () =>
      apiRequest<ExpenseResponse>(
        `/api/groups/${encodeURIComponent(groupId)}/expenses/${encodeURIComponent(expenseId)}`,
      ),
  });
  if (detail.isPending || expenseQuery.isPending) return <LoadingPage />;
  const error = detail.error ?? expenseQuery.error;
  if (status(error) === 401) {
    return (
      <Navigate
        to={`/login?next=${encodeURIComponent(`/groups/${groupId}/expenses/${expenseId}/edit`)}`}
        replace
      />
    );
  }
  if (detail.isError || expenseQuery.isError) return <ErrorPage error={error} />;
  if (!detail.data.access.canWriteExpense || detail.data.group.status === 'ARCHIVED') {
    return <ErrorPage error={{ status: 403 }} />;
  }

  const expense = expenseQuery.data.expense;
  const lockedPayerMemberId = constrainedPayer(detail.data.access);
  if (lockedPayerMemberId && expense.payerMemberId !== lockedPayerMemberId) {
    return <ErrorPage error={{ status: 404 }} />;
  }
  if (expense.lockedBySettlementId) {
    return (
      <section className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-6 sm:px-6 sm:py-10">
        <Button asChild variant="ghost" size="sm" className="-ml-2 self-start">
          <Link href={`/groups/${groupId}`}>
            <ChevronLeft /> {detail.data.group.name}
          </Link>
        </Button>
        <p className="text-muted-foreground rounded-md border border-dashed px-4 py-6 text-center text-sm">
          {t('errors.expense_locked')}
        </p>
      </section>
    );
  }

  const members = detail.data.members.map((member) => ({
    id: member.id,
    displayName: member.displayName,
  }));
  const parsedRule = splitRuleSchema.safeParse(expense.splitRule);
  const recoveredExactRule: SplitRule | null =
    expense.splits.length > 0
      ? {
          type: 'EXACT',
          amounts: expense.splits.map((split) => ({
            memberId: split.memberId,
            amountMinor: BigInt(split.shareMinor).toString(),
          })),
        }
      : null;
  const splitRule: SplitRule = parsedRule.success
    ? parsedRule.data
    : (recoveredExactRule ?? { type: 'EQUAL', memberIds: members.map((member) => member.id) });
  const parsedState = splitInputStateSchema.safeParse(expense.splitInputState);
  const splitInputState: SplitInputState | null = parsedState.success ? parsedState.data : null;
  const amountMinor = expense.amountMinor === null ? 0n : BigInt(expense.amountMinor);

  return (
    <section className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-5 px-4 py-5 sm:gap-7 sm:px-6 sm:py-10 lg:px-8">
      <Button asChild variant="ghost" size="sm" className="-ml-2 self-start">
        <Link href={`/groups/${groupId}`}>
          <ChevronLeft /> {detail.data.group.name}
        </Link>
      </Button>
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-3xl leading-none font-bold tracking-[-0.055em] sm:text-4xl">
          {t('expenses.edit')}
        </h1>
        <p className="text-muted-foreground max-w-xl text-sm leading-relaxed">
          {t('expenses.form_intro_edit')}
        </p>
      </header>
      <ExpenseForm
        groupId={groupId}
        groupCurrency={detail.data.group.defaultCurrency}
        members={members}
        lockedPayerMemberId={lockedPayerMemberId}
        defaults={{
          expenseId: expense.id,
          version: expense.version,
          occurredAt: new Date(expense.occurredAt),
          title: expense.title,
          note: expense.note,
          currency: expense.currency,
          amountText:
            expense.amountMinor === null
              ? ''
              : formatMinor(BigInt(expense.amountMinor), expense.currency),
          amountMinor,
          payerMemberId: expense.payerMemberId,
          splitRule,
          splitInputState,
          fxRateOverride:
            expense.currency === detail.data.group.defaultCurrency
              ? null
              : expense.fxRateToGroupCurrency,
          isDraft: expense.isDraft,
        }}
      />
    </section>
  );
}
