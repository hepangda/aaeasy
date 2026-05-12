'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { renameMemberAction } from '@/lib/groups/actions';
import { showI18nError } from '@/lib/ui/toast';

/**
 * Pencil button that opens a modal to rename a member of a group.
 * Visible only to callers with MANAGE_MEMBERS (decided by the parent).
 */
export function MemberRenameButton({
  groupId,
  memberId,
  currentName,
}: {
  groupId: string;
  memberId: string;
  currentName: string;
}) {
  const router = useRouter();
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(currentName);
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const res = await renameMemberAction({ groupId, memberId, displayName: name });
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
        size="sm"
        variant="ghost"
        onClick={() => {
          setName(currentName);
          setOpen(true);
        }}
        aria-label={t('members.rename')}
        title={t('members.rename')}
      >
        <Pencil />
      </Button>

      <Dialog open={open} onClose={() => setOpen(false)} title={t('members.rename')}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="flex flex-col gap-4"
        >
          <div className="grid gap-1.5">
            <Label htmlFor="rename-member" className="text-sm">
              {t('members.add_placeholder')}
            </Label>
            <Input
              id="rename-member"
              name="displayName"
              type="text"
              maxLength={40}
              required
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <footer className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? t('common.saving') : t('common.save')}
            </Button>
          </footer>
        </form>
      </Dialog>
    </>
  );
}
