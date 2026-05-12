import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { prisma } from '@/lib/db';
import { getCurrentSession } from '@/lib/auth/session';
import { getInitialAllowedUsernames } from '@/lib/auth/username-allowlist';
import { AllowedUsernameManager } from '@/components/allowed-username-manager';

export default async function AdminUsernamesPage() {
  const ctx = await getCurrentSession();
  if (!ctx) redirect('/login');
  if (!ctx.user.isSuperAdmin) redirect('/account');

  const t = await getTranslations('admin');
  const initialUsernames = getInitialAllowedUsernames();
  const usernames = await prisma.allowedUsername.findMany({
    orderBy: { username: 'asc' },
    select: { username: true },
  });

  return (
    <section className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-10">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground text-sm">{t('username_desc')}</p>
      </header>
      <AllowedUsernameManager
        usernames={usernames.map((item) => item.username)}
        initialUsernames={initialUsernames}
      />
    </section>
  );
}
