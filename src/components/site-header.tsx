import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { ThemeToggle } from '@/components/theme-toggle';
import { LogoutButton } from '@/components/logout-button';
import { Button } from '@/components/ui/button';
import { getCurrentSession } from '@/lib/auth/session';

export async function SiteHeader() {
  const t = await getTranslations();
  const ctx = await getCurrentSession();
  return (
    <header className="border-border/60 sticky top-0 z-40 w-full border-b backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="bg-foreground text-background grid size-7 place-items-center rounded-md text-xs font-bold">
            AA
          </span>
          {t('app.name')}
        </Link>
        <div className="flex items-center gap-1">
          <LocaleSwitcher />
          <ThemeToggle />
          {ctx ? (
            <>
              <Button asChild variant="ghost" size="sm">
                <Link href="/groups">{t('groups.my_groups')}</Link>
              </Button>
              <Button asChild variant="ghost" size="sm">
                <Link href="/account">
                  <span className="hidden sm:inline">{ctx.user.displayName}</span>
                  <span className="sm:hidden">{t('common.account')}</span>
                </Link>
              </Button>
              <LogoutButton />
            </>
          ) : (
            <Button asChild variant="ghost" size="sm">
              <Link href="/login">{t('common.login')}</Link>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
