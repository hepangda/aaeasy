import { useTranslations } from 'use-intl';
import Link from '@/router/link';
import type { LedgerMember } from '@/spa/types';
import { LedgerMemberStack } from '@/components/ledger/member-avatar';
import { Eyebrow } from '@/components/ui/eyebrow';

export function LedgerPageHeader({
  name,
  currency,
  members,
  archived,
}: {
  name: string;
  currency: string;
  members: LedgerMember[];
  archived: boolean;
}) {
  const t = useTranslations();

  return (
    <header className="flex flex-col gap-3 sm:gap-4">
      {/* The mobile header supplies its own back affordance, so this breadcrumb
          is desktop-only by design rather than by omission. */}
      <nav
        className="text-muted-foreground hidden min-w-0 items-center gap-2 text-xs md:flex"
        aria-label={t('groups.my_groups')}
      >
        <Link href="/groups" className="hover:text-foreground transition-colors">
          {t('groups.my_groups')}
        </Link>
        <span aria-hidden="true">/</span>
        <span className="text-foreground truncate">{name}</span>
      </nav>

      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-col gap-2.5 sm:gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
            <h1 className="font-display text-foreground truncate text-3xl leading-none font-bold tracking-[-0.04em] sm:text-4xl">
              {name}
            </h1>
            {archived ? (
              <Eyebrow as="span" variant="chip" tone="secondary" mono>
                {t('expenses.locked_badge')}
              </Eyebrow>
            ) : null}
          </div>
          <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs sm:gap-3">
            <LedgerMemberStack members={members} />
            <span>{t('groups.members_count', { count: members.length })}</span>
            <span aria-hidden="true" className="bg-border size-1 rounded-full" />
            <Eyebrow as="span" mono>
              {currency}
            </Eyebrow>
          </div>
        </div>
      </div>
    </header>
  );
}
