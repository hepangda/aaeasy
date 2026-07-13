import { useState, useTransition } from 'react';
import { useRouter } from '@/compat/navigation';
import { useTranslations } from 'use-intl';
import { Check, X, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { showI18nError, successToast } from '@/lib/ui/toast';
import {
  acceptInvitationsAction,
  rejectInvitationsAction,
  rejectAllInvitationsAction,
} from '@/spa/actions/invitations';
import type { GroupRole } from '@aaeasy/contracts';

export interface PendingInvitationItem {
  id: string;
  groupId: string;
  groupName: string;
  memberDisplayName: string;
  inviterDisplayName: string | null;
  inviterUsername: string | null;
  assignedRole: GroupRole;
  createdAt: string;
}

/**
 * Top-of-/groups panel listing invitations addressed to the current user.
 * Supports multi-select accept/reject and a one-click "reject all". Hidden
 * entirely when there are no pending invitations.
 */
export function PendingInvitationsPanel({ invitations }: { invitations: PendingInvitationItem[] }) {
  const t = useTranslations();
  const router = useRouter();
  const confirmDialog = useConfirm();
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [pending, startTransition] = useTransition();

  if (invitations.length === 0) return null;

  const allSelected = invitations.length > 0 && selected.size === invitations.length;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) =>
      prev.size === invitations.length ? new Set() : new Set(invitations.map((i) => i.id)),
    );
  }

  function reportResult(
    action: 'accept' | 'reject',
    accepted: string[] | undefined,
    failed: { id: string; error: string }[] | undefined,
  ) {
    const okCount = accepted?.length ?? 0;
    const failCount = failed?.length ?? 0;
    if (okCount > 0) {
      successToast(
        action === 'accept'
          ? t('invitations.accepted_toast', { count: okCount })
          : t('invitations.rejected_toast', { count: okCount }),
      );
    }
    if (failCount > 0) {
      // Surface the first distinct failure as a toast; the rest are visible
      // when the panel re-renders without the cleared rows.
      showI18nError(t, failed?.[0]?.error ?? 'errors.unknown');
    }
  }

  function accept(ids: string[]) {
    if (pending || ids.length === 0) return;
    startTransition(async () => {
      const res = await acceptInvitationsAction(ids);
      if (!res.ok) {
        showI18nError(t, res.error ?? 'errors.unknown');
        return;
      }
      reportResult('accept', res.accepted, res.failed);
      setSelected(new Set());
      router.refresh();
    });
  }

  function reject(ids: string[]) {
    if (pending || ids.length === 0) return;
    startTransition(async () => {
      const res = await rejectInvitationsAction(ids);
      if (!res.ok) {
        showI18nError(t, res.error ?? 'errors.unknown');
        return;
      }
      reportResult('reject', ids, undefined);
      setSelected(new Set());
      router.refresh();
    });
  }

  function rejectAll() {
    if (pending) return;
    confirmDialog({
      message: t('invitations.confirm_reject_all', { count: invitations.length }),
    }).then((ok) => {
      if (!ok) return;
      startTransition(async () => {
        const res = await rejectAllInvitationsAction();
        if (!res.ok) {
          showI18nError(t, res.error ?? 'errors.unknown');
          return;
        }
        successToast(t('invitations.rejected_toast', { count: invitations.length }));
        setSelected(new Set());
        router.refresh();
      });
    });
  }

  const selectedIds = Array.from(selected);

  return (
    <section className="bg-card flex flex-col gap-3 rounded-lg border p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="inline-flex items-center gap-1.5 text-base font-semibold">
          <Mail className="size-4" />
          {t('invitations.section_title')}
          <span className="bg-muted text-muted-foreground ml-1 inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-xs tabular-nums">
            {invitations.length}
          </span>
        </h2>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button type="button" size="sm" variant="ghost" onClick={toggleAll} disabled={pending}>
            {allSelected ? t('invitations.deselect_all') : t('invitations.select_all')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => accept(selectedIds)}
            disabled={pending || selectedIds.length === 0}
          >
            <Check />
            {t('invitations.accept_selected')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => reject(selectedIds)}
            disabled={pending || selectedIds.length === 0}
          >
            <X />
            {t('invitations.reject_selected')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            onClick={rejectAll}
            disabled={pending}
          >
            {t('invitations.reject_all')}
          </Button>
        </div>
      </header>
      <ul className="divide-y rounded-md border">
        {invitations.map((inv) => (
          <li key={inv.id} className="flex items-start gap-3 px-3 py-2.5 text-sm">
            <input
              type="checkbox"
              checked={selected.has(inv.id)}
              onChange={() => toggle(inv.id)}
              aria-label={t('invitations.select_row')}
              className="mt-1 size-4"
              disabled={pending}
            />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <p className="truncate">
                {t.rich('invitations.row_summary', {
                  inviter:
                    inv.inviterDisplayName ?? inv.inviterUsername ?? t('invitations.someone'),
                  role: t(`members.role.${inv.assignedRole}` as never),
                  member: inv.memberDisplayName,
                  group: inv.groupName,
                  b: (chunks) => <strong>{chunks}</strong>,
                })}
              </p>
              <span className="text-muted-foreground text-xs">{inv.createdAt}</span>
            </div>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => accept([inv.id])}
                disabled={pending}
                aria-label={t('invitations.accept')}
                title={t('invitations.accept')}
              >
                <Check className="text-primary" />
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => reject([inv.id])}
                disabled={pending}
                aria-label={t('invitations.reject')}
                title={t('invitations.reject')}
              >
                <X className="text-destructive" />
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
