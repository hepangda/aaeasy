import Link from '@/router/link';
import { useQuery } from '@tanstack/react-query';
import { Navigate, useParams } from 'react-router';
import { useTranslations } from 'use-intl';
import { ChevronLeft } from 'lucide-react';
import { ExpenseForm } from '@/components/expense/expense-form';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { PageShell } from '@/components/ui/page-shell';
import { formatMinor } from '@aaeasy/core/money';
import { splitInputStateSchema, type SplitInputState } from '@aaeasy/core/split-input-state';
import { splitRuleSchema, type SplitRule } from '@aaeasy/core/split-types';
import { apiRequest } from '../api';
import { ErrorPage } from '../page-state';
import { SkeletonPage } from '@/components/ui/skeleton';
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
  if (detail.isPending) return <SkeletonPage rows={4} />;
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
    <PageShell>
      <PageHeader title={t('expenses.add')} description={t('expenses.form_intro')} />
      <ExpenseForm
        groupId={groupId}
        groupCurrency={detail.data.group.defaultCurrency}
        members={members}
        lockedPayerMemberId={constrainedPayer(detail.data.access)}
      />
    </PageShell>
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
  if (detail.isPending || expenseQuery.isPending) return <SkeletonPage rows={4} />;
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
      <PageShell>
        <Button asChild variant="ghost" size="sm" className="-ml-3 self-start">
          <Link href={`/groups/${groupId}`}>
            <ChevronLeft /> {detail.data.group.name}
          </Link>
        </Button>
        <p className="text-muted-foreground rounded-md border border-dashed px-4 py-6 text-center text-sm">
          {t('errors.expense_locked')}
        </p>
      </PageShell>
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
  const amountMinor = BigInt(expense.amountMinor);

  return (
    <PageShell>
      <PageHeader title={t('expenses.edit')} description={t('expenses.form_intro_edit')} />
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
          amountText: formatMinor(amountMinor, expense.currency),
          amountMinor,
          payerMemberId: expense.payerMemberId,
          splitRule,
          splitInputState,
          fxRateOverride:
            expense.currency === detail.data.group.defaultCurrency
              ? null
              : expense.fxRateToGroupCurrency,
        }}
      />
    </PageShell>
  );
}
