import Link from '@/router/link';
import { Navigate } from 'react-router';
import { useFormatter, useTranslations } from 'use-intl';
import { Archive, ArrowUpRight, BookOpenText, Clock3, Plus, Users } from 'lucide-react';
import { PendingInvitationsPanel } from '@/components/invitations/pending-invitations-panel';
import { NewGroupForm } from '@/components/group/new-group-form';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Card } from '@/components/ui/card';
import { Eyebrow } from '@/components/ui/eyebrow';
import { PageHeader } from '@/components/ui/page-header';
import { PageShell } from '@/components/ui/page-shell';
import { ErrorPage, LoadingPage } from '../page-state';
import { SkeletonPage } from '@/components/ui/skeleton';
import { useGroupsQuery, useSessionQuery } from '../queries';

export function GroupsPage() {
  const t = useTranslations('groups');
  const roleT = useTranslations('members.role');
  const fmt = useFormatter();
  const session = useSessionQuery();
  const groups = useGroupsQuery(Boolean(session.data?.user));
  if (session.isPending) return <SkeletonPage />;
  if (session.isError) return <ErrorPage error={session.error} />;
  if (!session.data?.user) return <Navigate to="/login?next=/groups" replace />;
  if (groups.isPending) return <SkeletonPage />;
  if (groups.isError) return <ErrorPage error={groups.error} />;
  const orderedGroups = [...groups.data.groups].sort((left, right) => {
    if (left.status === right.status) return 0;
    return left.status === 'ARCHIVED' ? 1 : -1;
  });

  return (
    <PageShell>
      <PageHeader
        divider
        title={t('my_groups')}
        action={
          groups.data.groups.length > 0 ? (
            <Button asChild size="lg" className="w-full sm:w-auto">
              <Link href="/groups/new">
                <Plus /> {t('new_group')}
              </Link>
            </Button>
          ) : null
        }
      />

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
            const showRole = group.role !== 'OWNER';
            return (
              <li key={group.id} className="border-border border-b last:border-b-0">
                <Link
                  href={`/groups/${group.id}`}
                  className="hover:bg-accent/45 focus-visible:bg-accent/55 focus-visible:outline-primary group relative flex items-center gap-4 overflow-hidden py-5 pr-4 pl-5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 sm:px-6 sm:py-6"
                >
                  <span
                    aria-hidden
                    className={`absolute top-0 bottom-0 left-0 w-1 transition-all group-hover:w-1.5 ${
                      archived ? 'bg-signal' : 'bg-primary'
                    }`}
                  />

                  <div className="min-w-0 flex-1">
                    {archived || showRole ? (
                      <div className="mb-3 flex flex-wrap items-center gap-2">
                        {archived ? (
                          <Eyebrow
                            as="span"
                            variant="chip"
                            tone="signal"
                            mono
                            icon={<Archive aria-hidden="true" />}
                          >
                            {t('status_archived')}
                          </Eyebrow>
                        ) : null}
                        {showRole ? (
                          <Eyebrow as="span" variant="chip" tone="outline" mono>
                            {roleT(group.role)}
                          </Eyebrow>
                        ) : null}
                      </div>
                    ) : null}

                    <h2 className="tracking-display truncate text-xl leading-tight font-bold sm:text-2xl">
                      {group.name}
                    </h2>

                    <div className="text-muted-foreground mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
                      <span className="inline-flex items-center gap-1.5">
                        <Users className="text-primary-ink size-3.5" aria-hidden="true" />
                        {t('members_count', { count: group.memberCount })}
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <Clock3 className="text-primary-ink size-3.5" aria-hidden="true" />
                        {t('updated_at', {
                          date: fmt.dateTime(new Date(group.updatedAt), 'short'),
                        })}
                      </span>
                      <Eyebrow as="span" mono>
                        {group.defaultCurrency}
                      </Eyebrow>
                    </div>
                  </div>

                  <div className="text-primary-ink flex shrink-0 items-center self-center">
                    <span className="sr-only">{t('open')}</span>
                    <ArrowUpRight
                      aria-hidden="true"
                      className="size-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                    />
                  </div>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </PageShell>
  );
}

export function NewGroupPage() {
  const t = useTranslations('groups');
  const session = useSessionQuery();
  if (session.isPending) return <LoadingPage />;
  if (session.isError) return <ErrorPage error={session.error} />;
  if (!session.data?.user) return <Navigate to="/login?next=/groups/new" replace />;
  return (
    <PageShell width="narrow">
      <PageHeader title={t('new_group')} backLink={{ href: '/groups', label: t('my_groups') }} />
      <Card padding="body">
        <NewGroupForm />
      </Card>
    </PageShell>
  );
}
