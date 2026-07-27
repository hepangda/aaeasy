import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { useTranslations } from 'use-intl';
import Link from '@/compat/link';
import type { LedgerMember } from '@/spa/types';
import { LedgerMemberStack } from '@/components/ledger/member-avatar';
import { Button } from '@/components/ui/button';

function LedgerActionsMenu({ children }: { children: ReactNode }) {
  const t = useTranslations('common');
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function hasOpenModal() {
      return Boolean(document.querySelector('[role="dialog"][aria-modal="true"]'));
    }
    function onPointerDown(event: PointerEvent) {
      if (hasOpenModal() || rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.key !== 'Escape' || hasOpenModal()) return;
      setOpen(false);
      triggerRef.current?.focus();
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <Button
        ref={triggerRef}
        type="button"
        variant="outline"
        size="icon"
        className="size-10 rounded-md"
        aria-label={t('actions')}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <MoreHorizontal className="size-5" />
      </Button>
      {open ? (
        <div
          role="dialog"
          aria-label={t('actions')}
          className="bg-popover shadow-lifted absolute top-[calc(100%+0.5rem)] right-0 z-30 flex min-w-56 flex-col gap-2 rounded-lg border p-2.5 [&_button]:w-full [&>div]:w-full"
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

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
  primaryAction?: ReactNode;
  overflowActions?: ReactNode;
}) {
  const t = useTranslations();

  return (
    <header className="flex flex-col gap-3 sm:gap-4">
      <nav
        className="text-muted-foreground hidden min-w-0 items-center gap-2 text-xs sm:flex"
        aria-label={t('groups.my_groups')}
      >
        <Link href="/groups" className="hover:text-foreground transition-colors">
          {t('groups.my_groups')}
        </Link>
        <span aria-hidden>/</span>
        <span className="text-foreground truncate">{name}</span>
      </nav>

      <div className="flex items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-2.5 sm:gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
            <h1 className="font-display text-foreground truncate text-2xl leading-none font-bold tracking-[-0.045em] sm:text-4xl">
              {name}
            </h1>
            {archived ? (
              <span className="bg-secondary text-secondary-foreground rounded border px-2 py-1 font-mono text-[9px] font-semibold tracking-[0.14em] uppercase">
                {t('expenses.locked_badge')}
              </span>
            ) : null}
          </div>
          <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs sm:gap-3 sm:text-sm">
            <LedgerMemberStack members={members} />
            <span>{t('groups.members_count', { count: members.length })}</span>
            <span aria-hidden className="bg-border size-1 rounded-full" />
            <span className="font-mono text-xs tracking-[0.12em]">{currency}</span>
          </div>
        </div>

        {primaryAction || overflowActions ? (
          <div className="flex shrink-0 items-center gap-2">
            {overflowActions ? <LedgerActionsMenu>{overflowActions}</LedgerActionsMenu> : null}
            {primaryAction ? (
              <div className="[&>a]:h-10 [&>a]:rounded-md [&>a]:px-4">{primaryAction}</div>
            ) : null}
          </div>
        ) : null}
      </div>
    </header>
  );
}
