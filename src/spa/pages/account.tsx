import Link from '@/compat/link';
import { Navigate } from 'react-router';
import { useFormatter, useTranslations } from 'use-intl';
import { ExternalLink } from 'lucide-react';
import { DeleteAccountButton } from '@/components/account/delete-account-button';
import { Button } from '@/components/ui/button';
import { ErrorPage, LoadingPage } from '../page-state';
import { useAccountQuery, useSessionQuery } from '../queries';

export function AccountPage() {
  const t = useTranslations();
  const fmt = useFormatter();
  const session = useSessionQuery();
  const account = useAccountQuery(Boolean(session.data?.user));
  if (session.isPending) return <LoadingPage />;
  if (session.isError) return <ErrorPage error={session.error} />;
  if (!session.data?.user) return <Navigate to="/login?next=/account" replace />;
  if (account.isPending) return <LoadingPage />;
  if (account.isError) return <ErrorPage error={account.error} />;

  const initial = account.data.user.displayName.trim().charAt(0).toUpperCase() || 'A';

  return (
    <section className="flex w-full flex-1">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-7 px-4 py-7 sm:px-6 sm:py-10 lg:px-8">
        <header className="border-border flex flex-col gap-3 border-b pb-6 sm:pb-8">
          <h1 className="font-display text-3xl leading-none font-bold tracking-[-0.05em] sm:text-4xl">
            {t('account.title')}
          </h1>
          <p className="text-muted-foreground text-sm">{t('account.identity_managed_by')}</p>
        </header>

        <section
          aria-labelledby="account-identity-title"
          className="bg-card shadow-soft flex flex-col gap-6 rounded-xl border p-4 sm:p-6"
        >
          <div className="flex flex-col gap-1.5">
            <h2 id="account-identity-title" className="text-base font-semibold">
              {t('account.identity_title')}
            </h2>
            <p className="text-muted-foreground text-sm">{t('account.identity_desc')}</p>
          </div>
          <div className="flex items-center gap-4">
            {account.data.user.picture ? (
              <img
                src={account.data.user.picture}
                alt=""
                className="size-12 shrink-0 rounded-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <span className="bg-primary text-primary-foreground grid size-12 shrink-0 place-items-center rounded-lg text-base font-bold">
                {initial}
              </span>
            )}
            <dl className="min-w-0 flex-1 text-sm">
              <div className="flex min-w-0 gap-2">
                <dt className="text-muted-foreground shrink-0">{t('account.name_label')}</dt>
                <dd className="truncate font-semibold">{account.data.user.displayName}</dd>
              </div>
              {account.data.user.email ? (
                <div className="flex min-w-0 gap-2">
                  <dt className="text-muted-foreground shrink-0">{t('account.email_label')}</dt>
                  <dd className="truncate">{account.data.user.email}</dd>
                </div>
              ) : null}
              {account.data.user.username ? (
                <div className="flex min-w-0 gap-2">
                  <dt className="text-muted-foreground shrink-0">{t('account.handle_label')}</dt>
                  <dd className="truncate">@{account.data.user.username}</dd>
                </div>
              ) : null}
            </dl>
          </div>
          <div>
            <Button asChild variant="outline">
              <a href="/api/auth/account">
                {t('account.manage_identity')}
                <ExternalLink data-icon="inline-end" />
              </a>
            </Button>
          </div>
        </section>

        {account.data.user.isSuperAdmin ? (
          <section
            aria-labelledby="admin-all-ledgers-title"
            className="bg-card shadow-soft flex flex-col gap-4 rounded-xl border p-4 sm:p-6"
          >
            <div>
              <h2 id="admin-all-ledgers-title" className="text-base font-semibold">
                {t('admin.all_ledgers_title')}
              </h2>
              <p className="text-muted-foreground text-sm">{t('admin.all_ledgers_desc')}</p>
            </div>
            {account.data.allLedgers.length === 0 ? (
              <p className="text-muted-foreground rounded-md border border-dashed px-4 py-6 text-center text-sm">
                {t('admin.all_ledgers_empty')}
              </p>
            ) : (
              <ul className="divide-y rounded-md border">
                {account.data.allLedgers.map((group) => (
                  <li
                    key={group.id}
                    className="flex items-center justify-between gap-4 px-4 py-3 text-sm"
                  >
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        {group.deletedAt ? (
                          <span className="text-muted-foreground line-through">{group.name}</span>
                        ) : (
                          <Link
                            href={`/groups/${group.id}`}
                            className="font-medium hover:underline"
                          >
                            {group.name}
                          </Link>
                        )}
                        {group.deletedAt ? (
                          <span className="bg-destructive/15 text-destructive-ink rounded px-1.5 py-0.5 text-[10px] font-medium tracking-wide uppercase">
                            {t('admin.ledger_deleted_badge')}
                          </span>
                        ) : null}
                      </div>
                      <span className="text-muted-foreground text-xs">
                        {t('groups.created_at')}: {fmt.dateTime(new Date(group.createdAt), 'short')}{' '}
                        · {group.defaultCurrency} ·{' '}
                        {t('groups.members_count', { count: group.memberCount })}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        <section
          aria-labelledby="account-danger-zone"
          className="border-destructive/30 flex flex-col gap-4 rounded-xl border p-4 sm:p-6"
        >
          <div className="flex flex-col gap-1.5">
            <h2 id="account-danger-zone" className="text-destructive-ink text-base font-semibold">
              {t('account.danger_zone')}
            </h2>
            <p className="text-foreground text-sm font-medium">{t('account.delete_warning')}</p>
            <p className="text-muted-foreground text-sm">{t('account.delete_desc')}</p>
          </div>
          <DeleteAccountButton ownedGroups={account.data.ownedGroups} />
        </section>
      </div>
    </section>
  );
}
