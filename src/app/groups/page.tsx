import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations, getFormatter } from 'next-intl/server';
import { Plus, Users } from 'lucide-react';
import { prisma } from '@/lib/db';
import { getCurrentSession } from '@/lib/auth/session';
import { Button } from '@/components/ui/button';

export default async function GroupsPage() {
  const ctx = await getCurrentSession();
  if (!ctx) redirect('/login?next=/groups');

  const t = await getTranslations('groups');
  const fmt = await getFormatter();

  const groups = await prisma.group.findMany({
    where: { memberships: { some: { userId: ctx.user.id } } },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      name: true,
      defaultCurrency: true,
      status: true,
      createdAt: true,
      _count: { select: { members: true } },
    },
  });

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-10">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">{t('my_groups')}</h1>
        <Button asChild>
          <Link href="/groups/new">
            <Plus /> {t('new_group')}
          </Link>
        </Button>
      </header>

      {groups.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed px-6 py-12 text-center text-sm">
          {t('empty')}
        </p>
      ) : (
        <ul className="grid gap-3">
          {groups.map((g) => (
            <li key={g.id}>
              <Link
                href={`/groups/${g.id}`}
                className="group bg-card hover:border-foreground/20 flex flex-col gap-1 rounded-lg border px-4 py-4 transition-colors sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium">{g.name}</span>
                  <span className="text-muted-foreground text-xs">
                    {t('created_at')}: {fmt.dateTime(g.createdAt, 'short')} · {g.defaultCurrency}
                  </span>
                </div>
                <span className="text-muted-foreground inline-flex items-center gap-1 text-sm">
                  <Users className="size-4" />
                  {t('members_count', { count: g._count.members })}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
