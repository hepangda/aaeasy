import Link from '@/compat/link';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowRightLeft,
  BookOpenText,
  ChevronLeft,
  ChevronsUpDown,
  Plus,
  ReceiptText,
  Settings,
  UserRound,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';
import { Outlet, useLocation } from 'react-router';
import { useTranslations } from 'use-intl';
import { BrandMark } from '@/components/layout/brand-mark';
import { HeaderActionsMenu } from '@/components/layout/header-actions-menu';
import { ServiceWorkerRegister } from '@/components/layout/service-worker-register';
import { Button } from '@/components/ui/button';
import { Eyebrow } from '@/components/ui/eyebrow';
import { cn } from '@/lib/utils';
import type { GroupListResponse } from './types';
import { useGroupQuery, useGroupsQuery, useLedgerQuery, useSessionQuery } from './queries';
import { ErrorPage, LoadingPage } from './page-state';
import { useRouteAnnouncer } from './use-route-announcer';

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
      className="bg-foreground text-background shadow-lifted fixed top-3 left-3 z-[60] -translate-y-20 rounded-md px-4 py-2 text-sm font-semibold transition-transform focus:translate-y-0 focus:outline-hidden"
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

function GroupNavLink({ group, active }: { group: GroupListItem; active: boolean }) {
  return (
    <Link
      href={`/groups/${group.id}`}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex min-h-11 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors',
        active
          ? 'bg-accent text-accent-foreground font-semibold'
          : 'text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground',
      )}
    >
      <span aria-hidden="true" className="bg-primary size-1.5 shrink-0 rounded-sm" />
      <span className="min-w-0 flex-1 truncate">{group.name}</span>
      <span className="text-muted-foreground font-mono text-[10px] tabular-nums">
        {group.memberCount}
      </span>
    </Link>
  );
}

/**
 * Group switcher, shared by the mobile header and the desktop top bar.
 *
 * The group list used to live in a 248px sidebar that was permanently on
 * screen to serve a destination users pick roughly once per session. As a
 * dropdown it costs nothing until opened, and the same component now works at
 * every width.
 */
function GroupSwitcher({
  groups,
  currentGroupId,
  label,
  className,
}: {
  groups: GroupListItem[];
  currentGroupId: string;
  label: string;
  className?: string;
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const currentGroups = groups.filter((group) => group.status !== 'ARCHIVED');
  if (currentGroups.length === 0) return <p className="truncate text-sm font-bold">{label}</p>;

  return (
    <div ref={ref} className={cn('relative min-w-0', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={t('common.switch_group')}
        className="hover:bg-accent -mx-2 flex min-h-11 min-w-0 items-center gap-1.5 rounded-md px-2 transition-colors"
      >
        <span className="truncate text-sm font-bold tracking-[-0.025em]">{label}</span>
        <ChevronsUpDown className="text-muted-foreground size-3.5 shrink-0" aria-hidden="true" />
      </button>

      {open && (
        <div
          role="menu"
          className="border-border bg-popover shadow-lifted absolute top-[calc(100%+0.5rem)] left-0 z-50 max-h-80 w-64 overflow-y-auto rounded-xl border p-1.5"
        >
          <Eyebrow className="px-2 py-1.5">{t('groups.current_ledgers')}</Eyebrow>
          <ul className="flex flex-col gap-0.5">
            {currentGroups.map((group) => (
              <li key={group.id}>
                <GroupNavLink group={group} active={group.id === currentGroupId} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Desktop top bar.
 *
 * Replaces a fixed 248px sidebar, which cost the same width at every viewport
 * while carrying only low-frequency destinations, and collided with the summary
 * table's `md` grid (~79px figure columns at 768px).
 *
 * Scope matters here: this bar is application chrome — identity, account, and
 * which ledger you're looking at. The sections *within* a ledger belong to that
 * ledger's page, not to global chrome, so they live in the page header instead.
 */
function DesktopHeader({
  displayName,
  groups,
  currentGroupId,
  groupName,
  pathname,
}: {
  displayName: string;
  groups: GroupListItem[];
  currentGroupId: string;
  groupName?: string;
  pathname: string;
}) {
  const t = useTranslations();

  return (
    <header className="border-border bg-background/94 sticky top-0 z-40 hidden border-b backdrop-blur-lg lg:block">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="flex min-h-14 items-center gap-4">
          <BrandHomeLink compact />

          {currentGroupId && groupName ? (
            <>
              <span aria-hidden="true" className="bg-border h-5 w-px shrink-0" />
              <GroupSwitcher
                groups={groups}
                currentGroupId={currentGroupId}
                label={groupName}
                className="max-w-xs"
              />
            </>
          ) : null}

          <div className="ml-auto flex shrink-0 items-center gap-1">
            <Button asChild variant="ghost" size="sm">
              <Link href="/groups">
                <BookOpenText aria-hidden="true" />
                {t('groups.my_groups')}
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href="/groups/new">
                <Plus aria-hidden="true" />
                {t('groups.new_group')}
              </Link>
            </Button>
            <Link
              href="/account"
              aria-current={pathname.startsWith('/account') ? 'page' : undefined}
              aria-label={t('common.account')}
              className={cn(
                'hover:bg-accent grid size-9 place-items-center rounded-full transition-colors',
                pathname.startsWith('/account') && 'ring-primary ring-2',
              )}
            >
              <span className="bg-primary text-primary-foreground grid size-8 place-items-center rounded-full font-mono text-xs font-bold">
                {displayName.trim().charAt(0).toUpperCase() || 'A'}
              </span>
            </Link>
            <HeaderActionsMenu userDisplayName={displayName} />
          </div>
        </div>
      </div>
    </header>
  );
}

/**
 * Mobile header. Now carries a back affordance and the current context label —
 * previously it held only the brand and a hamburger, so a user deep in a group
 * had no in-app way back and no indication of where they were.
 */
function MobileHeader({
  displayName,
  backHref,
  title,
  groups,
  currentGroupId,
}: {
  displayName: string;
  backHref?: string;
  title?: string;
  groups: GroupListItem[];
  currentGroupId: string;
}) {
  const t = useTranslations('common');

  return (
    <header className="border-border bg-background/94 sticky top-0 z-40 border-b backdrop-blur-lg lg:hidden">
      <div className="flex min-h-14 items-center gap-2 px-4">
        {backHref ? (
          <Link
            href={backHref}
            aria-label={t('back')}
            className="hover:bg-accent -ml-2 grid size-11 shrink-0 place-items-center rounded-md transition-colors"
          >
            <ChevronLeft className="size-5" aria-hidden="true" />
          </Link>
        ) : (
          <BrandHomeLink compact />
        )}

        <div className="min-w-0 flex-1">
          {title &&
            (currentGroupId ? (
              <GroupSwitcher groups={groups} currentGroupId={currentGroupId} label={title} />
            ) : (
              <p className="truncate text-sm font-bold tracking-[-0.025em]">{title}</p>
            ))}
        </div>

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
        'relative flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 py-2 text-[10px] font-semibold transition-colors',
        prominent || active ? 'text-primary-ink' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {active ? (
        <span aria-hidden="true" className="bg-primary absolute inset-x-3 top-0 h-0.5" />
      ) : null}
      {prominent ? (
        <span className="bg-primary text-primary-foreground shadow-lifted -mt-3 grid size-11 place-items-center rounded-full">
          <Icon className="size-5" aria-hidden="true" />
        </span>
      ) : (
        <Icon className="size-4" aria-hidden="true" />
      )}
      <span className="max-w-full truncate">{label}</span>
    </Link>
  );
}

/**
 * The bottom nav keeps a stable shape: it always shows the three global
 * destinations, and adds group-scoped items only while inside a group. It no
 * longer disappears on the expense composer — that route instead gets a back
 * affordance in the header, so there is always a way out.
 */
function MobileBottomNav({
  pathname,
  hash,
  groupId,
}: {
  pathname: string;
  hash: string;
  groupId: string;
}) {
  const t = useTranslations();

  return (
    <nav
      aria-label={t('common.navigation')}
      className="border-border bg-background/96 pb-safe fixed inset-x-0 bottom-0 z-40 border-t backdrop-blur-lg lg:hidden"
    >
      <div className="mx-auto flex max-w-lg items-stretch px-1 py-1">
        {groupId ? (
          <>
            {/* Two sections, the compose action, two sections. Adding an
                expense is the reason this app exists, so it sits dead centre
                where a thumb naturally rests. */}
            <MobileNavItem
              href={`/groups/${groupId}#expenses`}
              label={t('expenses.title')}
              Icon={ReceiptText}
              active={!hash || hash === '#expenses'}
            />
            <MobileNavItem
              href={`/groups/${groupId}#settlement`}
              label={t('settlements.title')}
              Icon={ArrowRightLeft}
              active={['#settlement', '#summary', '#transfers'].includes(hash)}
            />
            <MobileNavItem
              href={`/groups/${groupId}/expenses/new`}
              label={t('expenses.add')}
              Icon={Plus}
              active={false}
              prominent
            />
            <MobileNavItem
              href={`/groups/${groupId}#members`}
              label={t('members.title')}
              Icon={UsersRound}
              active={hash === '#members'}
            />
            <MobileNavItem
              href={`/groups/${groupId}#settings`}
              label={t('groups.settings_short')}
              Icon={Settings}
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

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-background text-foreground flex min-h-svh flex-col">
      <main
        id={MAIN_CONTENT_ID}
        tabIndex={-1}
        className="flex min-h-svh flex-1 flex-col focus-visible:outline-hidden"
      >
        {children}
      </main>
    </div>
  );
}

export function AppLayout() {
  const location = useLocation();
  const t = useTranslations();
  useRouteAnnouncer(MAIN_CONTENT_ID);

  const groupRoute = location.pathname.match(/^\/groups\/([^/]+)/u);
  const routeGroupId = groupRoute?.[1] === 'new' ? '' : (groupRoute?.[1] ?? '');
  const isGroupOverview = Boolean(routeGroupId) && /^\/groups\/[^/]+\/?$/u.test(location.pathname);
  const session = useSessionQuery();
  const user = session.data?.user;
  const groups = useGroupsQuery(Boolean(user));
  // Start route data while the global session is still resolving. The page
  // reuses these query keys, avoiding a session -> page-data request waterfall.
  const group = useGroupQuery(routeGroupId);
  useLedgerQuery(routeGroupId, isGroupOverview);
  const isExpenseComposer = /^\/groups\/[^/]+\/expenses\/(?:new|[^/]+\/edit)$/.test(
    location.pathname,
  );

  if (session.isPending) {
    return (
      <>
        <SkipToMainContent />
        <Shell>
          <LoadingPage />
        </Shell>
        <ServiceWorkerRegister />
      </>
    );
  }

  if (session.isError) {
    return (
      <>
        <SkipToMainContent />
        <Shell>
          <ErrorPage error={session.error} />
        </Shell>
        <ServiceWorkerRegister />
      </>
    );
  }

  if (!user) {
    return (
      <>
        <SkipToMainContent />
        <div className="bg-background text-foreground flex min-h-svh flex-col">
          <AnonymousHeader />
          <main
            id={MAIN_CONTENT_ID}
            tabIndex={-1}
            className="flex min-h-[calc(100svh-3.5rem)] flex-1 flex-col focus-visible:outline-hidden"
          >
            <Outlet />
          </main>
        </div>
        <ServiceWorkerRegister />
      </>
    );
  }

  const groupList = groups.data?.groups ?? [];
  const groupName = group.data?.group?.name;

  // The composer is a focus mode: it keeps the bottom nav (so the user is never
  // stranded) but leads with an explicit back link to the group it belongs to.
  const backHref = isExpenseComposer
    ? `/groups/${routeGroupId}`
    : location.pathname === '/groups/new'
      ? '/groups'
      : undefined;

  const headerTitle = isExpenseComposer
    ? t('expenses.add')
    : location.pathname === '/groups/new'
      ? t('groups.new_group')
      : routeGroupId
        ? groupName
        : location.pathname.startsWith('/account')
          ? t('common.account')
          : t('groups.my_groups');

  return (
    <>
      <SkipToMainContent />
      <div className="bg-background text-foreground min-h-svh">
        <DesktopHeader
          displayName={user.displayName}
          groups={groupList}
          currentGroupId={isExpenseComposer ? '' : routeGroupId}
          groupName={groupName}
          pathname={location.pathname}
        />
        <MobileHeader
          displayName={user.displayName}
          backHref={backHref}
          title={headerTitle}
          groups={groupList}
          currentGroupId={isExpenseComposer ? '' : routeGroupId}
        />
        <main
          id={MAIN_CONTENT_ID}
          tabIndex={-1}
          className="pb-bottom-nav flex min-h-[calc(100svh-3.5rem)] flex-col focus-visible:outline-hidden lg:min-h-svh lg:pb-0"
        >
          <Outlet />
        </main>
        <MobileBottomNav
          pathname={location.pathname}
          hash={location.hash}
          groupId={isExpenseComposer ? '' : routeGroupId}
        />
      </div>
      <ServiceWorkerRegister />
    </>
  );
}
