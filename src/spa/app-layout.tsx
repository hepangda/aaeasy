import Link from '@/compat/link';
import {
  ArrowRightLeft,
  BookOpenText,
  Plus,
  ReceiptText,
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
import { useGroupQuery, useGroupsQuery, useLedgerQuery, useSessionQuery } from './queries';
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
      className="bg-foreground text-background fixed top-3 left-3 z-[60] -translate-y-20 rounded-md px-4 py-2 text-sm font-semibold shadow-md transition-transform focus:translate-y-0 focus:outline-hidden"
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
      className="focus-visible:ring-ring/25 rounded-md focus-visible:ring-3 focus-visible:outline-hidden"
    >
      <BrandMark iconClassName={compact ? 'size-8' : undefined} />
    </Link>
  );
}

function AnonymousHeader() {
  return (
    <header className="border-border bg-background/94 sticky top-0 z-40 border-b backdrop-blur-lg">
      <div className="mx-auto flex min-h-14 w-full max-w-7xl items-center justify-between gap-4 px-5 sm:px-8 lg:px-10">
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
        'flex min-h-10 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-semibold transition-colors',
        active
          ? 'bg-primary text-primary-foreground'
          : 'text-sidebar-foreground/62 hover:bg-sidebar-foreground/8 hover:text-sidebar-foreground',
      )}
    >
      <Icon className="size-4" aria-hidden="true" />
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
    <aside className="border-sidebar-foreground/10 bg-sidebar text-sidebar-foreground fixed inset-y-0 left-0 z-40 hidden w-[15.5rem] flex-col border-r px-3 py-4 lg:flex">
      <div className="px-1">
        <BrandHomeLink />
      </div>

      <nav aria-label={t('groups.my_groups')} className="mt-8 flex flex-col gap-1">
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
        <div className="mt-7 min-h-0 flex-1 overflow-y-auto px-1">
          <p className="text-sidebar-foreground/42 mb-2.5 px-2 text-[10px] font-semibold tracking-[0.16em] uppercase">
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
                      'flex min-h-9 items-center gap-2.5 rounded-md px-2.5 text-[13px] transition-colors',
                      active
                        ? 'bg-sidebar-foreground/10 text-sidebar-foreground font-semibold'
                        : 'text-sidebar-foreground/55 hover:bg-sidebar-foreground/7 hover:text-sidebar-foreground',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className="bg-primary size-1.5 shrink-0 rounded-[2px]"
                    />
                    <span className="min-w-0 flex-1 truncate">{group.name}</span>
                    <span className="text-sidebar-foreground/38 font-mono text-[10px] tabular-nums">
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

      <div className="border-sidebar-foreground/10 mt-5 flex items-center gap-1.5 border-t pt-3">
        <Link
          href="/account"
          aria-current={pathname.startsWith('/account') ? 'page' : undefined}
          className={cn(
            'hover:bg-sidebar-foreground/7 flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 py-2 transition-colors',
            pathname.startsWith('/account') ? 'bg-sidebar-foreground/10' : undefined,
          )}
        >
          <span className="bg-primary text-primary-foreground grid size-8 shrink-0 place-items-center rounded-md text-xs font-bold">
            {initial}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{displayName}</span>
            <span className="text-sidebar-foreground/42 block truncate text-[10px]">
              {t('common.account')}
            </span>
          </span>
        </Link>
        <HeaderActionsMenu userDisplayName={displayName} inverted />
      </div>
    </aside>
  );
}

function MobileHeader({ displayName }: { displayName: string }) {
  return (
    <header className="border-border bg-background/94 sticky top-0 z-40 border-b backdrop-blur-lg lg:hidden">
      <div className="flex min-h-14 items-center justify-between gap-3 px-4">
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
  prominent = false,
}: {
  href: string;
  label: string;
  Icon: LucideIcon;
  active: boolean;
  prominent?: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 px-2 py-2 text-[11px] font-semibold transition-colors',
        prominent
          ? 'text-primary-ink'
          : active
            ? 'text-primary-ink'
            : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {active ? (
        <span aria-hidden="true" className="bg-primary absolute inset-x-5 top-0 h-0.5" />
      ) : null}
      {prominent ? (
        <span className="bg-primary text-primary-foreground -mt-2 grid size-9 place-items-center rounded-md">
          <Icon className="size-4" aria-hidden="true" />
        </span>
      ) : (
        <Icon className="size-4" aria-hidden="true" />
      )}
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
      className="border-border bg-background/96 fixed inset-x-0 bottom-0 z-40 border-t pb-[env(safe-area-inset-bottom)] backdrop-blur-lg lg:hidden"
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
              href={`/groups/${groupId}/expenses/new`}
              label={t('expenses.add')}
              Icon={Plus}
              active={false}
              prominent
            />
            <MobileNavItem
              href={`/groups/${groupId}#settlement`}
              label={t('settlements.title')}
              Icon={ArrowRightLeft}
              active={['#settlement', '#summary', '#transfers'].includes(hash)}
            />
            <MobileNavItem
              href={`/groups/${groupId}#settings`}
              label={t('groups.settings_short')}
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
  const location = useLocation();
  const groupRoute = location.pathname.match(/^\/groups\/([^/]+)/u);
  const routeGroupId = groupRoute?.[1] === 'new' ? '' : (groupRoute?.[1] ?? '');
  const isGroupOverview = Boolean(routeGroupId) && /^\/groups\/[^/]+\/?$/u.test(location.pathname);
  const session = useSessionQuery();
  const user = session.data?.user;
  const groups = useGroupsQuery(Boolean(user));
  // Start route data while the global session is still resolving. The page
  // reuses these query keys, avoiding a session -> page-data request waterfall.
  useGroupQuery(routeGroupId);
  useLedgerQuery(routeGroupId, isGroupOverview);
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
          className="flex min-h-[calc(100dvh-3.5rem)] flex-1 flex-col focus-visible:outline-hidden"
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
        <div className="lg:pl-[15.5rem]">
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
