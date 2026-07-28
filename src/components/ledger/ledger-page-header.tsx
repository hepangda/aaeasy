import type { ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { useTranslations } from 'use-intl';
import Link from '@/compat/link';
import type { LedgerMember } from '@/spa/types';
import { LedgerMemberStack } from '@/components/ledger/member-avatar';
import { Button } from '@/components/ui/button';
import { Eyebrow } from '@/components/ui/eyebrow';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function LedgerPageHeader({
  name,
  currency,
  members,
  archived,
  primaryAction,
  overflowActions,
}: {
  name: string;
  currency: string;
  members: LedgerMember[];
  archived: boolean;
  /**
   * The page's most consequential action. Rendered as a peer of the title
   * rather than hidden behind the overflow — "Settle" used to live in the
   * unlabelled `⋯` menu at the same level as Export.
   */
  primaryAction?: ReactNode;
  overflowActions?: ReactNode;
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

      <div className="flex items-start justify-between gap-3">
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

        {primaryAction || overflowActions ? (
          <div className="flex shrink-0 items-center gap-2">
            {primaryAction}
            {overflowActions ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label={t('common.actions')}
                  >
                    <MoreHorizontal className="size-5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="flex min-w-56 flex-col gap-2 p-2.5 [&_button]:w-full [&>div]:w-full"
                >
                  {overflowActions}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        ) : null}
      </div>
    </header>
  );
}
