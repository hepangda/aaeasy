import Link from '@/router/link';
import { Navigate } from 'react-router';
import { useFormatter, useTranslations } from 'use-intl';
import { ExternalLink } from 'lucide-react';
import { DeleteAccountButton } from '@/components/account/delete-account-button';
import { Button } from '@/components/ui/button';
import { ErrorPage } from '../page-state';
import { SkeletonPage } from '@/components/ui/skeleton';
import { Card } from '@/components/ui/card';
import { DangerZone } from '@/components/ui/danger-zone';
import { Eyebrow } from '@/components/ui/eyebrow';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader, SectionHeader } from '@/components/ui/page-header';
import { PageShell } from '@/components/ui/page-shell';
import { useAccountQuery, useSessionQuery } from '../queries';

export function AccountPage() {
  const t = useTranslations();
  const fmt = useFormatter();
  const session = useSessionQuery();
  const account = useAccountQuery(Boolean(session.data?.user));
  if (session.isPending) return <SkeletonPage rows={4} />;
  if (session.isError) return <ErrorPage error={session.error} />;
  if (!session.data?.user) return <Navigate to="/login?next=/account" replace />;
  if (account.isPending) return <SkeletonPage rows={4} />;
  if (account.isError) return <ErrorPage error={account.error} />;

  const initial = account.data.user.displayName.trim().charAt(0).toUpperCase() || 'A';

  return (
    <PageShell>
      <PageHeader
        divider
        title={t('account.title')}
        description={t('account.identity_managed_by')}
      />

      <Card
        as="section"
        padding="body"
        aria-labelledby="account-identity-title"
        className="flex flex-col gap-6"
      >
        <SectionHeader
          title={<span id="account-identity-title">{t('account.identity_title')}</span>}
          description={t('account.identity_desc')}
        />
        <div className="flex items-center gap-4">
          {account.data.user.picture ? (
            <img
              src={account.data.user.picture}
              alt=""
              className="size-12 shrink-0 rounded-full object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            <span className="bg-primary text-primary-foreground grid size-12 shrink-0 place-items-center rounded-full font-mono text-base font-bold">
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
      </Card>

      {account.data.user.isSuperAdmin ? (
        <Card
          as="section"
          padding="body"
          aria-labelledby="admin-all-ledgers-title"
          className="flex flex-col gap-4"
        >
          <SectionHeader
            title={<span id="admin-all-ledgers-title">{t('admin.all_ledgers_title')}</span>}
            description={t('admin.all_ledgers_desc')}
          />
          {account.data.allLedgers.length === 0 ? (
            <EmptyState compact title={t('admin.all_ledgers_empty')} />
          ) : (
            <ul className="divide-border divide-y rounded-xl border">
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
                          className="font-semibold hover:underline"
                        >
                          {group.name}
                        </Link>
                      )}
                      {group.deletedAt ? (
                        <Eyebrow as="span" variant="chip" tone="danger">
                          {t('admin.ledger_deleted_badge')}
                        </Eyebrow>
                      ) : null}
                    </div>
                    <span className="text-muted-foreground text-xs">
                      {t('groups.created_at')}: {fmt.dateTime(new Date(group.createdAt), 'short')} ·{' '}
                      {group.defaultCurrency} ·{' '}
                      {t('groups.members_count', { count: group.memberCount })}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      <DangerZone
        title={t('account.danger_zone')}
        description={
          <>
            <span className="text-foreground block font-semibold">
              {t('account.delete_warning')}
            </span>
            {t('account.delete_desc')}
          </>
        }
      >
        <DeleteAccountButton ownedGroups={account.data.ownedGroups} />
      </DangerZone>
    </PageShell>
  );
}
