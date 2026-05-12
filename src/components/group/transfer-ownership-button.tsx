'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Crown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Select } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { transferOwnershipAction } from '@/lib/auth/account-actions';
import { showI18nError } from '@/lib/ui/toast';

export interface OwnerCandidate {
  /** GroupMembership.userId of a non-OWNER user with a linked Member. */
  userId: string;
  /** Display label — usually `member.displayName (@username)`. */
  label: string;
}

/**
 * OWNER-only button that opens a modal for transferring the OWNER role
 * to another linked member. Disabled when no eligible candidates exist
 * (no other linked members in the group).
 */
export function TransferOwnershipButton({
  groupId,
  candidates,
}: {
  groupId: string;
  candidates: OwnerCandidate[];
}) {
  const t = useTranslations();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<string>(candidates[0]?.userId ?? '');

  function submit() {
    if (!selected || pending) return;
    startTransition(async () => {
      const res = await transferOwnershipAction({
        groupId,
        newOwnerUserId: selected,
      });
      if (!res.ok) {
        showI18nError(t, res.error ?? 'errors.unknown');
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        disabled={candidates.length === 0}
        title={
          candidates.length === 0 ? t('groups.transfer_no_candidates') : undefined
        }
      >
        <Crown /> {t('groups.transfer_owner')}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('groups.transfer_owner')}
        className="max-w-md"
      >
        <p className="text-muted-foreground text-sm">
          {t('groups.transfer_owner_desc')}
        </p>

        <div className="grid gap-1.5">
          <Label htmlFor="new-owner" className="text-xs">
            {t('groups.transfer_to')}
          </Label>
          <Select
            id="new-owner"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            {candidates.map((c) => (
              <option key={c.userId} value={c.userId}>
                {c.label}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={!selected || pending}
          >
            {pending ? t('common.save') + '…' : t('groups.transfer_confirm')}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
