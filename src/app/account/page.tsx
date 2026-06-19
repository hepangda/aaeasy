import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getTranslations, getFormatter } from 'next-intl/server';
import { prisma } from '@/lib/db';
import { getCurrentSession } from '@/lib/auth/session';
import { listOwnedGroups } from '@/lib/auth/account-actions';
import { PasskeyEnrollButton } from '@/components/auth/passkey-buttons';
import { PasskeyDeleteButton } from '@/components/auth/passkey-delete-button';
import { PasswordDeleteButton } from '@/components/auth/password-delete-button';
import { AddPasswordButton } from '@/components/auth/add-password-button';
import { CredentialRenameButton } from '@/components/auth/credential-rename-button';
import { SetDisplayNameForm } from '@/components/account/set-display-name-form';
import { DeleteAccountButton } from '@/components/account/delete-account-button';
import { Tabs } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';

export default async function AccountPage() {
  const ctx = await getCurrentSession();
  if (!ctx) redirect('/login');

  const t = await getTranslations();
  const fmt = await getFormatter();

  const isSuperAdmin = ctx.user.isSuperAdmin;

  const [passkeys, passwordCredentials, ownedGroups, allLedgers] = await Promise.all([
    prisma.passkeyCredential.findMany({
      where: { userId: ctx.user.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        deviceLabel: true,
        createdAt: true,
        lastUsedAt: true,
        transports: true,
      },
    }),
    prisma.passwordCredential.findMany({
      where: { userId: ctx.user.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        label: true,
        createdAt: true,
        lastUsedAt: true,
      },
    }),
    listOwnedGroups(),
    isSuperAdmin
      ? prisma.group.findMany({
          orderBy: [{ deletedAt: 'asc' }, { createdAt: 'desc' }],
          select: {
            id: true,
            name: true,
            defaultCurrency: true,
            createdAt: true,
            deletedAt: true,
            _count: { select: { members: true } },
          },
        })
      : Promise.resolve(
          [] as Array<{
            id: string;
            name: string;
            defaultCurrency: string;
            createdAt: Date;
            deletedAt: Date | null;
            _count: { members: number };
          }>,
        ),
  ]);

  const credentials = [
    ...passkeys.map((pk) => ({
      id: pk.id,
      type: 'passkey' as const,
      title: pk.deviceLabel ?? t('passkey.unnamed_device'),
      meta: [
        `${t('passkey.added')}: ${fmt.dateTime(pk.createdAt, 'short')}`,
        pk.lastUsedAt ? `${t('passkey.last_used')}: ${fmt.dateTime(pk.lastUsedAt, 'short')}` : null,
        pk.transports.length > 0 ? pk.transports.join(', ') : null,
      ].filter(Boolean) as string[],
    })),
    ...passwordCredentials.map((pc) => ({
      id: pc.id,
      type: 'password' as const,
      title: pc.label ?? t('account.password_item_title'),
      meta: [
        `${t('passkey.added')}: ${fmt.dateTime(pc.createdAt, 'short')}`,
        pc.lastUsedAt ? `${t('passkey.last_used')}: ${fmt.dateTime(pc.lastUsedAt, 'short')}` : null,
      ].filter(Boolean) as string[],
    })),
  ];

  return (
    <section className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-10 px-6 py-10">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('account.title')}</h1>
        <p className="text-muted-foreground text-sm">
          {t('account.signed_in_as')} <strong>{ctx.user.displayName}</strong>
          {ctx.user.username ? <> (@{ctx.user.username})</> : null}
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
                <SetDisplayNameForm currentDisplayName={ctx.user.displayName} />
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
                    {credentials.map((cred) => (
                      <li
                        key={`${cred.type}-${cred.id}`}
                        className="flex items-center justify-between gap-4 px-4 py-3 text-sm"
                      >
                        <div className="flex flex-col">
                          <span className="font-medium">{cred.title}</span>
                          <span className="text-muted-foreground text-xs">
                            {cred.type === 'passkey'
                              ? t('passkey.section_title')
                              : t('account.password_section')}
                            {cred.meta.length > 0 ? <> · {cred.meta.join(' · ')}</> : null}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <CredentialRenameButton
                            kind={cred.type}
                            credentialId={cred.id}
                            currentLabel={cred.title}
                          />
                          {cred.type === 'passkey' ? (
                            <PasskeyDeleteButton credentialId={cred.id} />
                          ) : (
                            <PasswordDeleteButton credentialId={cred.id} />
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="flex flex-wrap gap-2 pt-2">
                  <PasskeyEnrollButton deviceLabel={ctx.session.userAgent ?? undefined} />
                  <AddPasswordButton />
                </div>
              </section>
            ),
          },
          ...(isSuperAdmin
            ? [
                {
                  id: 'admin',
                  label: t('admin.tab'),
                  content: (
                    <section className="flex flex-col gap-8">
                      <div className="flex flex-col gap-4">
                        <p className="text-muted-foreground text-sm">{t('admin.account_desc')}</p>
                        <div className="flex flex-wrap gap-2">
                          <Button asChild className="w-fit">
                            <Link href="/account/admin/usernames">{t('admin.open_usernames')}</Link>
                          </Button>
                          <Button asChild variant="outline" className="w-fit">
                            <Link href="/account/admin/users">{t('admin.open_user_merge')}</Link>
                          </Button>
                        </div>
                      </div>

                      <div className="flex flex-col gap-3">
                        <div className="flex flex-col gap-1">
                          <h2 className="text-sm font-medium">{t('admin.all_ledgers_title')}</h2>
                          <p className="text-muted-foreground text-xs">
                            {t('admin.all_ledgers_desc')}
                          </p>
                        </div>
                        {allLedgers.length === 0 ? (
                          <p className="text-muted-foreground rounded-md border border-dashed px-4 py-6 text-center text-sm">
                            {t('admin.all_ledgers_empty')}
                          </p>
                        ) : (
                          <ul className="divide-y rounded-md border">
                            {allLedgers.map((g) => {
                              const isDeleted = g.deletedAt !== null;
                              const meta = `${t('groups.created_at')}: ${fmt.dateTime(g.createdAt, 'short')} · ${g.defaultCurrency} · ${t('groups.members_count', { count: g._count.members })}`;
                              return (
                                <li
                                  key={g.id}
                                  className="flex items-center justify-between gap-4 px-4 py-3 text-sm"
                                >
                                  <div className="flex min-w-0 flex-col gap-0.5">
                                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                      {isDeleted ? (
                                        <span className="text-muted-foreground line-through">
                                          {g.name}
                                        </span>
                                      ) : (
                                        <Link
                                          href={`/groups/${g.id}`}
                                          className="hover:underline font-medium"
                                        >
                                          {g.name}
                                        </Link>
                                      )}
                                      {isDeleted && (
                                        <span className="bg-destructive/15 text-destructive inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium tracking-wide uppercase">
                                          {t('admin.ledger_deleted_badge')}
                                        </span>
                                      )}
                                    </div>
                                    <span className="text-muted-foreground text-xs">{meta}</span>
                                  </div>
                                </li>
                              );
                            })}
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
                <div className="rounded-md border border-destructive/50 bg-destructive/5 px-4 py-3">
                  <p className="text-sm font-medium text-destructive">
                    {t('account.delete_warning')}
                  </p>
                </div>
                <p className="text-muted-foreground text-sm">{t('account.delete_desc')}</p>
                <DeleteAccountButton ownedGroups={ownedGroups} />
              </section>
            ),
          },
        ]}
      />
    </section>
  );
}
