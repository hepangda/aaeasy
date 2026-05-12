import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ChevronLeft } from 'lucide-react';
import { prisma } from '@/lib/db';
import { AccessError, requireGroupAccess } from '@/lib/auth/group-access';
import { formatMinor } from '@/lib/money';
import { splitRuleSchema, type SplitRule } from '@/lib/split/types';
import { Button } from '@/components/ui/button';
import { ExpenseForm } from '@/components/expense-form';

export default async function EditExpensePage({
  params,
}: {
  params: Promise<{ id: string; expenseId: string }>;
}) {
  const { id, expenseId } = await params;
  let access;
  try {
    access = await requireGroupAccess(id, 'WRITE_EXPENSE');
  } catch (e) {
    if (e instanceof AccessError) {
      if (e.code === 'NOT_FOUND') notFound();
      if (e.code === 'UNAUTHENTICATED')
        redirect(`/login?next=/groups/${id}/expenses/${expenseId}/edit`);
      notFound();
    }
    throw e;
  }
  // Bound writers (per-member share OR a logged-in user with role=MEMBER
  // linked to a member) can only edit expenses where they are the payer.
  // The payer field is locked to that member id in the form.
  const lockedPayerMemberId =
    access.kind === 'share'
      ? access.boundMemberId ?? undefined
      : access.role === 'MEMBER'
        ? access.linkedMemberId ?? undefined
        : undefined;

  const t = await getTranslations();
  const [group, expense] = await Promise.all([
    prisma.group.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        name: true,
        defaultCurrency: true,
        members: { orderBy: { sortOrder: 'asc' }, select: { id: true, displayName: true } },
      },
    }),
    prisma.expense.findUnique({
      where: { id: expenseId },
      select: {
        id: true,
        groupId: true,
        occurredAt: true,
        title: true,
        note: true,
        currency: true,
        amountMinor: true,
        fxRateToGroupCurrency: true,
        payerMemberId: true,
        splitRule: true,
        deletedAt: true,
        lockedBySettlementId: true,
        isDraft: true,
      },
    }),
  ]);
  if (!expense || expense.groupId !== id || expense.deletedAt) notFound();
  if (expense.lockedBySettlementId) {
    // Locked: render a read-only message instead of the form.
    return (
      <section className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-10">
        <Button asChild variant="ghost" size="sm" className="-ml-2 self-start">
          <Link href={`/groups/${id}`}>
            <ChevronLeft /> {group.name}
          </Link>
        </Button>
        <p className="text-muted-foreground rounded-md border border-dashed px-4 py-6 text-center text-sm">
          {t('errors.expense_locked')}
        </p>
      </section>
    );
  }
  // Bound share: hide the edit form when the visitor isn't the payer of
  // this expense. The action layer also enforces this; UI just refuses to
  // show controls for an action that would 403.
  if (lockedPayerMemberId && expense.payerMemberId !== lockedPayerMemberId) {
    notFound();
  }

  const splitRuleParsed = splitRuleSchema.safeParse(expense.splitRule);
  const splitRule: SplitRule = splitRuleParsed.success
    ? splitRuleParsed.data
    : { type: 'EQUAL', memberIds: group.members.map((m) => m.id) };

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-10">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href={`/groups/${id}`}>
            <ChevronLeft /> {group.name}
          </Link>
        </Button>
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">{t('expenses.edit')}</h1>
      <ExpenseForm
        groupId={id}
        groupCurrency={group.defaultCurrency}
        members={group.members}
        lockedPayerMemberId={lockedPayerMemberId}
        defaults={{
          expenseId: expense.id,
          occurredAt: expense.occurredAt,
          title: expense.title,
          note: expense.note,
          currency: expense.currency,
          amountText:
            expense.amountMinor != null
              ? formatMinor(expense.amountMinor, expense.currency)
              : '',
          amountMinor: expense.amountMinor ?? 0n,
          payerMemberId: expense.payerMemberId,
          splitRule,
          fxRateOverride: null,
          isDraft: expense.isDraft,
        }}
      />
    </section>
  );
}
