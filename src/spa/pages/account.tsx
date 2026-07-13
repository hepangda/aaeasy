import Link from '@/compat/link';
import { useQuery } from '@tanstack/react-query';
import { Navigate } from 'react-router';
import { useFormatter, useTranslations } from 'use-intl';
import { DeleteAccountButton } from '@/components/account/delete-account-button';
import { SetDisplayNameForm } from '@/components/account/set-display-name-form';
import { AddPasswordButton } from '@/components/auth/add-password-button';
import { AllowedUsernameManager } from '@/components/auth/allowed-username-manager';
import { CredentialRenameButton } from '@/components/auth/credential-rename-button';
import { PasskeyDeleteButton } from '@/components/auth/passkey-delete-button';
import { PasskeyEnrollButton } from '@/components/auth/passkey-buttons';
import { PasswordDeleteButton } from '@/components/auth/password-delete-button';
import { UserMergeManager } from '@/components/auth/user-merge-manager';
import { Button } from '@/components/ui/button';
import { Tabs } from '@/components/ui/tabs';
import { apiRequest } from '../api';
import { ErrorPage, LoadingPage } from '../page-state';
import { useAccountQuery, useSessionQuery } from '../queries';

export function AccountPage() {
  const t = useTranslations();
  const fmt = useFormatter();
  const session = useSessionQuery();
  const account = useAccountQuery(Boolean(session.data?.user));
  if (session.isPending || account.isPending) return <LoadingPage />;
  if (!session.data?.user) return <Navigate to="/login?next=/account" replace />;
  if (account.isError) return <ErrorPage error={account.error} />;

  const credentials = account.data.credentials.map((credential) => ({
    id: credential.id,
    type: credential.kind,
    title:
      credential.label ??
      (credential.kind === 'passkey'
        ? t('passkey.unnamed_device')
        : t('account.password_item_title')),
    meta: [
      `${t('passkey.added')}: ${fmt.dateTime(new Date(credential.createdAt), 'short')}`,
      credential.lastUsedAt
        ? `${t('passkey.last_used')}: ${fmt.dateTime(new Date(credential.lastUsedAt), 'short')}`
        : null,
      credential.transports.length > 0 ? credential.transports.join(', ') : null,
    ].filter(Boolean) as string[],
  }));

  return (
    <section className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-10 px-6 py-10">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('account.title')}</h1>
        <p className="text-muted-foreground text-sm">
          {t('account.signed_in_as')} <strong>{account.data.user.displayName}</strong>
          {account.data.user.username ? <> (@{account.data.user.username})</> : null}
        </p>
      </header>
      <Tabs
        defaultTab="security"
        tabs={[
          {
            id: 'profile',
            label: t('account.profile'),
            content: (
              <section className="flex flex-col gap-4">
                <p className="text-muted-foreground text-sm">{t('account.profile_desc')}</p>
                <SetDisplayNameForm currentDisplayName={account.data.user.displayName} />
              </section>
            ),
          },
          {
            id: 'security',
            label: t('account.security_section'),
            content: (
              <section className="flex flex-col gap-4">
                <p className="text-muted-foreground text-sm">{t('account.security_desc')}</p>
                <h2 className="text-sm font-medium">{t('account.credentials_title')}</h2>
                {credentials.length === 0 ? (
                  <p className="text-muted-foreground rounded-md border border-dashed px-4 py-6 text-center text-sm">
                    {t('account.credentials_empty')}
                  </p>
                ) : (
                  <ul className="divide-y rounded-md border">
                    {credentials.map((credential) => (
                      <li
                        key={`${credential.type}-${credential.id}`}
                        className="flex items-center justify-between gap-4 px-4 py-3 text-sm"
                      >
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate font-medium">{credential.title}</span>
                          <span className="text-muted-foreground text-xs">
                            {credential.type === 'passkey'
                              ? t('passkey.section_title')
                              : t('account.password_section')}
                            {credential.meta.length > 0 ? (
                              <> · {credential.meta.join(' · ')}</>
                            ) : null}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <CredentialRenameButton
                            kind={credential.type}
                            credentialId={credential.id}
                            currentLabel={credential.title}
                          />
                          {credential.type === 'passkey' ? (
                            <PasskeyDeleteButton credentialId={credential.id} />
                          ) : (
                            <PasswordDeleteButton credentialId={credential.id} />
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex flex-wrap gap-2 pt-2">
                  <PasskeyEnrollButton deviceLabel={account.data.session.userAgent ?? undefined} />
                  <AddPasswordButton />
                </div>
              </section>
            ),
          },
          ...(account.data.user.isSuperAdmin
            ? [
                {
                  id: 'admin',
                  label: t('admin.tab'),
                  content: (
                    <section className="flex flex-col gap-8">
                      <div className="flex flex-col gap-4">
                        <p className="text-muted-foreground text-sm">{t('admin.account_desc')}</p>
                        <div className="flex flex-wrap gap-2">
                          <Button asChild>
                            <Link href="/account/admin/usernames">{t('admin.open_usernames')}</Link>
                          </Button>
                          <Button asChild variant="outline">
                            <Link href="/account/admin/users">{t('admin.open_user_merge')}</Link>
                          </Button>
                        </div>
                      </div>
                      <div className="flex flex-col gap-3">
                        <div>
                          <h2 className="text-sm font-medium">{t('admin.all_ledgers_title')}</h2>
                          <p className="text-muted-foreground text-xs">
                            {t('admin.all_ledgers_desc')}
                          </p>
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
                                      <span className="text-muted-foreground line-through">
                                        {group.name}
                                      </span>
                                    ) : (
                                      <Link
                                        href={`/groups/${group.id}`}
                                        className="font-medium hover:underline"
                                      >
                                        {group.name}
                                      </Link>
                                    )}
                                    {group.deletedAt && (
                                      <span className="bg-destructive/15 text-destructive rounded px-1.5 py-0.5 text-[10px] font-medium tracking-wide uppercase">
                                        {t('admin.ledger_deleted_badge')}
                                      </span>
                                    )}
                                  </div>
                                  <span className="text-muted-foreground text-xs">
                                    {t('groups.created_at')}:{' '}
                                    {fmt.dateTime(new Date(group.createdAt), 'short')} ·{' '}
                                    {group.defaultCurrency} ·{' '}
                                    {t('groups.members_count', { count: group.memberCount })}
                                  </span>
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </section>
                  ),
                },
              ]
            : []),
          {
            id: 'delete',
            label: t('account.delete_button'),
            content: (
              <section className="flex flex-col gap-4">
                <div className="border-destructive/50 bg-destructive/5 rounded-md border px-4 py-3">
                  <p className="text-destructive text-sm font-medium">
                    {t('account.delete_warning')}
                  </p>
                </div>
                <p className="text-muted-foreground text-sm">{t('account.delete_desc')}</p>
                <DeleteAccountButton ownedGroups={account.data.ownedGroups} />
              </section>
            ),
          },
        ]}
      />
    </section>
  );
}

export function AdminUsernamesPage() {
  const t = useTranslations('admin');
  const session = useSessionQuery();
  const query = useQuery({
    queryKey: ['admin', 'usernames'],
    queryFn: () =>
      apiRequest<{ usernames: string[]; initialUsernames: string[] }>('/api/admin/usernames'),
    enabled: Boolean(session.data?.user?.isSuperAdmin),
  });
  if (session.isPending) return <LoadingPage />;
  if (!session.data?.user) return <Navigate to="/login" replace />;
  if (!session.data.user.isSuperAdmin) return <Navigate to="/account" replace />;
  if (query.isPending) return <LoadingPage />;
  if (query.isError) return <ErrorPage error={query.error} />;
  return (
    <section className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-10">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground text-sm">{t('username_desc')}</p>
      </header>
      <AllowedUsernameManager
        usernames={query.data.usernames}
        initialUsernames={query.data.initialUsernames}
      />
    </section>
  );
}

export function AdminUsersPage() {
  const t = useTranslations('admin');
  const session = useSessionQuery();
  const query = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: () =>
      apiRequest<{
        currentUserId: string;
        users: Array<{
          id: string;
          displayName: string;
          username: string | null;
          isSuperAdmin: boolean;
          groupCount: number;
          loginCount: number;
        }>;
      }>('/api/admin/users'),
    enabled: Boolean(session.data?.user?.isSuperAdmin),
  });
  if (session.isPending) return <LoadingPage />;
  if (!session.data?.user) return <Navigate to="/login" replace />;
  if (!session.data.user.isSuperAdmin) return <Navigate to="/account" replace />;
  if (query.isPending) return <LoadingPage />;
  if (query.isError) return <ErrorPage error={query.error} />;
  return (
    <section className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-10">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('user_merge_title')}</h1>
        <p className="text-muted-foreground text-sm">{t('user_merge_desc')}</p>
      </header>
      <UserMergeManager users={query.data.users} currentUserId={query.data.currentUserId} />
    </section>
  );
}
