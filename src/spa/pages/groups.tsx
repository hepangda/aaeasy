import Link from '@/compat/link';
import { Navigate } from 'react-router';
import { useFormatter, useTranslations } from 'use-intl';
import { Plus, Users } from 'lucide-react';
import { PendingInvitationsPanel } from '@/components/invitations/pending-invitations-panel';
import { NewGroupForm } from '@/components/group/new-group-form';
import { Button } from '@/components/ui/button';
import { ErrorPage, LoadingPage } from '../page-state';
import { useGroupsQuery, useSessionQuery } from '../queries';

export function GroupsPage() {
  const t = useTranslations('groups');
  const fmt = useFormatter();
  const session = useSessionQuery();
  const groups = useGroupsQuery(Boolean(session.data?.user));
  if (session.isPending) return <LoadingPage />;
  if (!session.data?.user) return <Navigate to="/login?next=/groups" replace />;
  if (groups.isPending) return <LoadingPage />;
  if (groups.isError) return <ErrorPage error={groups.error} />;

  return (
    <section className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-6 sm:gap-8 sm:px-6 sm:py-10 lg:px-8">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t('my_groups')}</h1>
        <Button asChild>
          <Link href="/groups/new">
            <Plus /> {t('new_group')}
          </Link>
        </Button>
      </header>
      <PendingInvitationsPanel
        invitations={groups.data.invitations.map((invitation) => ({
          ...invitation,
          createdAt: fmt.dateTime(new Date(invitation.createdAt), 'short'),
        }))}
      />
      {groups.data.groups.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed px-6 py-12 text-center text-sm">
          {t('empty')}
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {groups.data.groups.map((group) => (
            <li key={group.id}>
              <Link
                href={`/groups/${group.id}`}
                className="group bg-card hover:border-foreground/20 flex min-h-28 flex-col justify-between gap-4 rounded-lg border px-4 py-4 transition-colors"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium">{group.name}</span>
                  <span className="text-muted-foreground text-xs">
                    {t('created_at')}: {fmt.dateTime(new Date(group.createdAt), 'short')} ·{' '}
                    {group.defaultCurrency}
                  </span>
                </div>
                <span className="text-muted-foreground inline-flex items-center gap-1 text-sm">
                  <Users className="size-4" />
                  {t('members_count', { count: group.memberCount })}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function NewGroupPage() {
  const t = useTranslations('groups');
  const session = useSessionQuery();
  if (session.isPending) return <LoadingPage />;
  if (!session.data?.user) return <Navigate to="/login?next=/groups/new" replace />;
  return (
    <section className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">{t('new_group')}</h1>
      <NewGroupForm />
    </section>
  );
}
