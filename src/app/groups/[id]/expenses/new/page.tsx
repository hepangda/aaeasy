import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ChevronLeft } from 'lucide-react';
import { prisma } from '@/lib/db';
import { AccessError, requireGroupAccess } from '@/lib/auth/group-access';
import { Button } from '@/components/ui/button';
import { ExpenseForm } from '@/components/expense-form';

export default async function NewExpensePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let access;
  try {
    access = await requireGroupAccess(id, 'WRITE_EXPENSE');
  } catch (e) {
    if (e instanceof AccessError) {
      if (e.code === 'NOT_FOUND') notFound();
      if (e.code === 'UNAUTHENTICATED') redirect(`/login?next=/groups/${id}/expenses/new`);
      notFound();
    }
    throw e;
  }

  const lockedPayerMemberId =
    access.kind === 'share'
      ? access.boundMemberId ?? undefined
      : access.role === 'MEMBER'
        ? access.linkedMemberId ?? undefined
        : undefined;

  const t = await getTranslations();
  const group = await prisma.group.findUniqueOrThrow({
    where: { id },
    select: {
      id: true,
      name: true,
      defaultCurrency: true,
      members: { orderBy: { sortOrder: 'asc' }, select: { id: true, displayName: true } },
    },
  });

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-10">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href={`/groups/${id}`}>
            <ChevronLeft /> {group.name}
          </Link>
        </Button>
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">{t('expenses.new_title')}</h1>
      <ExpenseForm
        groupId={id}
        groupCurrency={group.defaultCurrency}
        members={group.members}
        lockedPayerMemberId={lockedPayerMemberId}
      />
    </section>
  );
}
