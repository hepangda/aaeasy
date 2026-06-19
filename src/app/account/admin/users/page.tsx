import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { prisma } from '@/lib/db';
import { getCurrentSession } from '@/lib/auth/session';
import { UserMergeManager } from '@/components/auth/user-merge-manager';

export default async function AdminUsersPage() {
  const ctx = await getCurrentSession();
  if (!ctx) redirect('/login');
  if (!ctx.user.isSuperAdmin) redirect('/account');

  const t = await getTranslations('admin');
  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      displayName: true,
      username: true,
      isSuperAdmin: true,
      _count: {
        select: { memberships: true, passkeys: true, passwordCredentials: true },
      },
    },
  });

  return (
    <section className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-10">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('user_merge_title')}</h1>
        <p className="text-muted-foreground text-sm">{t('user_merge_desc')}</p>
      </header>
      <UserMergeManager
        users={users.map((u) => ({
          id: u.id,
          displayName: u.displayName,
          username: u.username,
          isSuperAdmin: u.isSuperAdmin,
          groupCount: u._count.memberships,
          loginCount: u._count.passkeys + u._count.passwordCredentials,
        }))}
        currentUserId={ctx.user.id}
      />
    </section>
  );
}
