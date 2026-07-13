import Link from '@/compat/link';
import { Outlet } from 'react-router';
import { useTranslations } from 'use-intl';
import { HeaderActionsMenu } from '@/components/layout/header-actions-menu';
import { ServiceWorkerRegister } from '@/components/layout/service-worker-register';
import { Button } from '@/components/ui/button';
import { useSessionQuery } from './queries';

export function AppLayout() {
  const t = useTranslations();
  const session = useSessionQuery();

  return (
    <div className="bg-background text-foreground flex min-h-dvh flex-col">
      <header className="border-border/60 bg-background/85 sticky top-0 z-40 w-full border-b backdrop-blur-sm">
        <div className="mx-auto flex min-h-14 max-w-6xl items-center justify-between gap-3 px-4 py-2 sm:px-6 lg:px-8">
          <Link href="/" className="flex min-w-0 items-center gap-2 font-semibold tracking-tight">
            <span className="bg-foreground text-background grid size-7 place-items-center rounded-md text-xs font-bold">
              AA
            </span>
            <span className="truncate">{t('app.name')}</span>
          </Link>
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-1">
            {session.data?.user && (
              <Button asChild variant="ghost" size="sm">
                <Link href="/groups">{t('groups.my_groups')}</Link>
              </Button>
            )}
            <HeaderActionsMenu userDisplayName={session.data?.user?.displayName} />
          </div>
        </div>
      </header>
      <main className="flex flex-1 flex-col">
        <Outlet />
      </main>
      <ServiceWorkerRegister />
    </div>
  );
}
