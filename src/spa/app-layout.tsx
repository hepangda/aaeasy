import Link from '@/compat/link';
import {
  ArrowRightLeft,
  BookOpenText,
  Plus,
  ReceiptText,
  Scale,
  UserRound,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';
import { Outlet, useLocation } from 'react-router';
import { useTranslations } from 'use-intl';
import { BrandMark } from '@/components/layout/brand-mark';
import { HeaderActionsMenu } from '@/components/layout/header-actions-menu';
import { ServiceWorkerRegister } from '@/components/layout/service-worker-register';
import { cn } from '@/lib/utils';
import type { GroupListResponse } from './types';
import { useGroupsQuery, useSessionQuery } from './queries';
import { ErrorPage, LoadingPage } from './page-state';

type GroupListItem = GroupListResponse['groups'][number];

const MAIN_CONTENT_ID = 'main-content';

function SkipToMainContent() {
  const t = useTranslations('common');
  return (
    <a
      href={`#${MAIN_CONTENT_ID}`}
      onClick={(event) => {
        event.preventDefault();
        document.getElementById(MAIN_CONTENT_ID)?.focus();
      }}
      className="bg-foreground text-background fixed top-3 left-3 z-[60] -translate-y-20 rounded-lg px-4 py-2 text-sm font-semibold shadow-md transition-transform focus:translate-y-0 focus:outline-hidden"
    >
      {t('skip_to_content')}
    </a>
  );
}

function BrandHomeLink({ compact = false }: { compact?: boolean }) {
  const t = useTranslations('app');
  return (
    <Link
      href="/"
      aria-label={t('name')}
      className="focus-visible:ring-ring/25 rounded-lg focus-visible:ring-4 focus-visible:outline-hidden"
    >
      <BrandMark iconClassName={compact ? 'size-8' : undefined} />
    </Link>
  );
}

function AnonymousHeader() {
  return (
    <header className="border-border/70 bg-background/88 sticky top-0 z-40 border-b backdrop-blur-xl">
      <div className="mx-auto flex min-h-16 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <BrandHomeLink compact />
        <HeaderActionsMenu />
      </div>
    </header>
  );
}

function SidebarNavLink({
  href,
  label,
  Icon,
  active,
}: {
  href: string;
  label: string;
  Icon: LucideIcon;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition-colors',
        active
          ? 'bg-secondary text-secondary-foreground'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      <Icon className="size-4.5" aria-hidden="true" />
      <span className="truncate">{label}</span>
    </Link>
  );
}

function DesktopSidebar({
  displayName,
  groups,
  pathname,
}: {
  displayName: string;
  groups: GroupListItem[];
  pathname: string;
}) {
  const t = useTranslations();
  const initial = displayName.trim().charAt(0).toUpperCase() || 'A';
  const currentGroups = groups.filter((group) => group.status !== 'ARCHIVED');

  return (
    <aside className="border-border/70 bg-sidebar text-sidebar-foreground fixed inset-y-0 left-0 z-40 hidden w-[17rem] flex-col border-r px-4 py-5 lg:flex">
      <div className="px-1">
        <BrandHomeLink />
      </div>

      <nav aria-label={t('groups.my_groups')} className="mt-10 flex flex-col gap-1">
        <SidebarNavLink
          href="/groups"
          label={t('groups.my_groups')}
          Icon={BookOpenText}
          active={pathname === '/groups'}
        />
        <SidebarNavLink
          href="/groups/new"
          label={t('groups.new_group')}
          Icon={Plus}
          active={pathname === '/groups/new'}
        />
      </nav>

      {currentGroups.length > 0 ? (
        <div className="mt-8 min-h-0 flex-1 overflow-y-auto px-1">
          <p className="text-muted-foreground mb-3 px-2 text-[11px] font-bold tracking-[0.12em] uppercase">
            {t('groups.current_ledgers')}
          </p>
          <ul className="flex flex-col gap-1">
            {currentGroups.map((group) => {
              const href = `/groups/${group.id}`;
              const active = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <li key={group.id}>
                  <Link
                    href={href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex min-h-10 items-center gap-3 rounded-lg px-2.5 text-sm transition-colors',
                      active
                        ? 'bg-muted text-foreground font-semibold'
                        : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className="bg-primary/60 size-2 shrink-0 rounded-full"
                    />
                    <span className="min-w-0 flex-1 truncate">{group.name}</span>
                    <span className="text-muted-foreground/70 text-[11px] tabular-nums">
                      {group.memberCount}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <div className="flex-1" />
      )}

      <div className="border-border/70 mt-6 flex items-center gap-2 border-t pt-4">
        <Link
          href="/account"
          aria-current={pathname.startsWith('/account') ? 'page' : undefined}
          className={cn(
            'hover:bg-accent flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-2 transition-colors',
            pathname.startsWith('/account') ? 'bg-muted' : undefined,
          )}
        >
          <span className="bg-primary text-primary-foreground grid size-9 shrink-0 place-items-center rounded-full text-sm font-bold shadow-sm">
            {initial}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{displayName}</span>
            <span className="text-muted-foreground block truncate text-[11px]">
              {t('common.account')}
            </span>
          </span>
        </Link>
        <HeaderActionsMenu userDisplayName={displayName} />
      </div>
    </aside>
  );
}

function MobileHeader({ displayName }: { displayName: string }) {
  return (
    <header className="border-border/65 bg-background/88 sticky top-0 z-40 border-b backdrop-blur-xl lg:hidden">
      <div className="flex min-h-16 items-center justify-between gap-3 px-4">
        <BrandHomeLink compact />
        <HeaderActionsMenu userDisplayName={displayName} />
      </div>
    </header>
  );
}

function MobileNavItem({
  href,
  label,
  Icon,
  active,
}: {
  href: string;
  label: string;
  Icon: LucideIcon;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 px-2 py-2 text-[11px] font-semibold transition-colors',
        active ? 'text-primary-ink' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {active ? (
        <span
          aria-hidden="true"
          className="bg-primary absolute inset-x-5 top-0 h-0.5 rounded-full"
        />
      ) : null}
      <Icon className="size-4.5" aria-hidden="true" />
      <span className="max-w-full truncate">{label}</span>
    </Link>
  );
}

function MobileBottomNav({ pathname, hash }: { pathname: string; hash: string }) {
  const t = useTranslations();
  const groupMatch = pathname.match(/^\/groups\/([^/]+)\/?$/);
  const groupId = groupMatch?.[1];

  return (
    <nav
      aria-label={t('common.actions')}
      className="border-border/70 bg-background/95 fixed inset-x-0 bottom-0 z-40 border-t pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden"
    >
      <div className="mx-auto flex min-h-16 max-w-lg items-stretch gap-1 px-2 py-1">
        {groupId ? (
          <>
            <MobileNavItem
              href={`/groups/${groupId}#expenses`}
              label={t('expenses.title')}
              Icon={ReceiptText}
              active={!hash || hash === '#expenses'}
            />
            <MobileNavItem
              href={`/groups/${groupId}#summary`}
              label={t('summary.title')}
              Icon={Scale}
              active={hash === '#summary'}
            />
            <MobileNavItem
              href={`/groups/${groupId}#transfers`}
              label={t('summary.transfers_title')}
              Icon={ArrowRightLeft}
              active={hash === '#transfers'}
            />
            <MobileNavItem
              href={`/groups/${groupId}#settings`}
              label={t('groups.settings')}
              Icon={UsersRound}
              active={hash === '#settings'}
            />
          </>
        ) : (
          <>
            <MobileNavItem
              href="/groups"
              label={t('groups.my_groups')}
              Icon={BookOpenText}
              active={pathname === '/groups'}
            />
            <MobileNavItem
              href="/groups/new"
              label={t('groups.new_group')}
              Icon={Plus}
              active={pathname === '/groups/new'}
            />
            <MobileNavItem
              href="/account"
              label={t('common.account')}
              Icon={UserRound}
              active={pathname.startsWith('/account')}
            />
          </>
        )}
      </div>
    </nav>
  );
}

export function AppLayout() {
  const session = useSessionQuery();
  const user = session.data?.user;
  const groups = useGroupsQuery(Boolean(user));
  const location = useLocation();
  const isExpenseComposer = /^\/groups\/[^/]+\/expenses\/(?:new|[^/]+\/edit)$/.test(
    location.pathname,
  );

  let shell: React.ReactNode;

  if (session.isPending) {
    shell = (
      <div className="bg-background text-foreground flex min-h-dvh flex-col">
        <main
          id={MAIN_CONTENT_ID}
          tabIndex={-1}
          className="flex min-h-dvh flex-1 flex-col focus-visible:outline-hidden"
        >
          <LoadingPage />
        </main>
      </div>
    );
  } else if (session.isError) {
    shell = (
      <div className="bg-background text-foreground flex min-h-dvh flex-col">
        <main
          id={MAIN_CONTENT_ID}
          tabIndex={-1}
          className="flex min-h-dvh flex-1 flex-col focus-visible:outline-hidden"
        >
          <ErrorPage error={session.error} />
        </main>
      </div>
    );
  } else if (!user) {
    shell = (
      <div className="bg-background text-foreground flex min-h-dvh flex-col">
        <AnonymousHeader />
        <main
          id={MAIN_CONTENT_ID}
          tabIndex={-1}
          className="flex min-h-[calc(100dvh-4rem)] flex-1 flex-col focus-visible:outline-hidden"
        >
          <Outlet />
        </main>
      </div>
    );
  } else {
    shell = (
      <div className="bg-background text-foreground min-h-dvh">
        <DesktopSidebar
          displayName={user.displayName}
          groups={groups.data?.groups ?? []}
          pathname={location.pathname}
        />
        <MobileHeader displayName={user.displayName} />
        <div className="lg:pl-[17rem]">
          <main
            id={MAIN_CONTENT_ID}
            tabIndex={-1}
            className={cn(
              'flex min-h-[calc(100dvh-4rem)] flex-col focus-visible:outline-hidden lg:min-h-dvh lg:pb-0',
              isExpenseComposer ? 'pb-0' : 'pb-20',
            )}
          >
            <Outlet />
          </main>
        </div>
        {isExpenseComposer ? null : (
          <MobileBottomNav pathname={location.pathname} hash={location.hash} />
        )}
      </div>
    );
  }

  return (
    <>
      <SkipToMainContent />
      {shell}
      <ServiceWorkerRegister />
    </>
  );
}
