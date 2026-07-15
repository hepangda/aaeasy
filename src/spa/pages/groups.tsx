import Link from '@/compat/link';
import { Navigate } from 'react-router';
import { useFormatter, useTranslations } from 'use-intl';
import { Archive, ArrowLeft, ArrowUpRight, BookOpenText, Clock3, Plus, Users } from 'lucide-react';
import { PendingInvitationsPanel } from '@/components/invitations/pending-invitations-panel';
import { NewGroupForm } from '@/components/group/new-group-form';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorPage, LoadingPage } from '../page-state';
import { useGroupsQuery, useSessionQuery } from '../queries';

export function GroupsPage() {
  const t = useTranslations('groups');
  const roleT = useTranslations('members.role');
  const fmt = useFormatter();
  const session = useSessionQuery();
  const groups = useGroupsQuery(Boolean(session.data?.user));
  if (session.isPending) return <LoadingPage />;
  if (session.isError) return <ErrorPage error={session.error} />;
  if (!session.data?.user) return <Navigate to="/login?next=/groups" replace />;
  if (groups.isPending) return <LoadingPage />;
  if (groups.isError) return <ErrorPage error={groups.error} />;
  const orderedGroups = [...groups.data.groups].sort((left, right) => {
    if (left.status === right.status) return 0;
    return left.status === 'ARCHIVED' ? 1 : -1;
  });

  return (
    <section className="bg-background text-foreground flex w-full flex-1">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-7 sm:gap-10 sm:px-6 sm:py-11 lg:px-8">
        <header className="border-border flex flex-col gap-5 border-b pb-7 sm:flex-row sm:items-end sm:justify-between sm:pb-9">
          <h1 className="font-display text-3xl leading-none font-semibold tracking-[-0.045em] sm:text-5xl">
            {t('my_groups')}
          </h1>
          {groups.data.groups.length > 0 ? (
            <Button asChild size="lg" className="w-full sm:w-auto">
              <Link href="/groups/new">
                <Plus /> {t('new_group')}
              </Link>
            </Button>
          ) : null}
        </header>

        <PendingInvitationsPanel
          invitations={groups.data.invitations.map((invitation) => ({
            ...invitation,
            createdAt: fmt.dateTime(new Date(invitation.createdAt), 'short'),
          }))}
        />

        {groups.data.groups.length === 0 ? (
          <EmptyState
            icon={<BookOpenText />}
            title={t('empty_title')}
            description={t('empty_desc')}
            action={
              <Button asChild className="w-full sm:w-auto">
                <Link href="/groups/new">
                  <Plus /> {t('new_group')}
                </Link>
              </Button>
            }
          />
        ) : (
          <ol className="border-border border-y">
            {orderedGroups.map((group) => {
              const archived = group.status === 'ARCHIVED';
              return (
                <li key={group.id} className="border-border border-b last:border-b-0">
                  <Link
                    href={`/groups/${group.id}`}
                    className="hover:bg-card/55 focus-visible:bg-card/70 focus-visible:outline-primary group dark:hover:bg-card/20 dark:focus-visible:bg-card/25 relative grid gap-5 overflow-hidden py-6 pr-1 pl-4 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-6 sm:py-7"
                  >
                    <span
                      aria-hidden
                      className={`absolute top-0 bottom-0 left-0 w-1 transition-all group-hover:w-1.5 ${
                        archived ? 'bg-signal' : 'bg-primary'
                      }`}
                    />

                    <div className="min-w-0">
                      <div className="mb-3 flex flex-wrap items-center gap-2">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10px] font-semibold tracking-[0.12em] uppercase ${
                            archived
                              ? 'bg-signal/25 text-signal-foreground dark:bg-signal/18 dark:text-signal'
                              : 'bg-primary/10 text-primary-ink dark:bg-primary/20'
                          }`}
                        >
                          {archived ? (
                            <Archive className="size-3" />
                          ) : (
                            <span className="size-1.5 rounded-full bg-current" />
                          )}
                          {t(archived ? 'status_archived' : 'status_active')}
                        </span>
                        <span className="border-border inline-flex rounded-full border px-2.5 py-1 font-mono text-[10px] font-semibold tracking-[0.12em] uppercase">
                          {roleT(group.role)}
                        </span>
                      </div>

                      <h2 className="truncate text-2xl leading-tight font-semibold tracking-[-0.035em] sm:text-3xl">
                        {group.name}
                      </h2>

                      <div className="text-muted-foreground mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
                        <span className="inline-flex items-center gap-1.5">
                          <Users className="text-primary-ink size-3.5" />
                          {t('members_count', { count: group.memberCount })}
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <Clock3 className="text-primary-ink size-3.5" />
                          {t('updated_at', {
                            date: fmt.dateTime(new Date(group.updatedAt), 'short'),
                          })}
                        </span>
                      </div>
                    </div>

                    <div className="border-border flex items-end justify-between gap-5 border-t pt-4 sm:min-w-32 sm:flex-col sm:items-end sm:border-t-0 sm:pt-0">
                      <span className="text-muted-foreground font-mono text-sm font-semibold tracking-[0.12em] uppercase">
                        {group.defaultCurrency}
                      </span>
                      <span className="text-primary-ink inline-flex items-center gap-1 text-sm font-semibold">
                        {t('open')}
                        <ArrowUpRight className="size-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                      </span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}

export function NewGroupPage() {
  const t = useTranslations('groups');
  const session = useSessionQuery();
  if (session.isPending) return <LoadingPage />;
  if (session.isError) return <ErrorPage error={session.error} />;
  if (!session.data?.user) return <Navigate to="/login?next=/groups/new" replace />;
  return (
    <section className="bg-background text-foreground flex w-full flex-1">
      <div className="mx-auto flex w-full max-w-3xl flex-col px-4 py-6 sm:px-6 sm:py-10 lg:px-8">
        <Button asChild variant="ghost" size="sm" className="mb-8 -ml-3 self-start">
          <Link href="/groups">
            <ArrowLeft /> {t('my_groups')}
          </Link>
        </Button>

        <div className="flex flex-1 flex-col gap-8">
          <header>
            <h1 className="font-display text-3xl leading-[1.05] font-semibold tracking-[-0.045em] sm:text-5xl">
              {t('new_group')}
            </h1>
          </header>

          <div className="bg-card shadow-soft rounded-2xl border p-4 sm:p-7">
            <NewGroupForm />
          </div>
        </div>
      </div>
    </section>
  );
}
