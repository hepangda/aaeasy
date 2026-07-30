import { useEffect, useState, useTransition } from 'react';
import { useRouter } from '@/router/navigation';
import { useTranslations } from 'use-intl';
import { Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { renameMemberAction } from '@/spa/actions/groups';
import { showI18nError } from '@/lib/ui/toast';

/**
 * Rename dialog for a member of a group. Ownership of the open state sits with
 * the caller so the dialog can survive the unmount of whatever opened it — an
 * overflow menu item closes its menu on select.
 */
export function MemberRenameDialog({
  groupId,
  memberId,
  currentName,
  open,
  onOpenChange,
}: {
  groupId: string;
  memberId: string;
  currentName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const t = useTranslations();
  const [name, setName] = useState(currentName);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (open) setName(currentName);
  }, [open, currentName]);

  function submit() {
    startTransition(async () => {
      const res = await renameMemberAction({ groupId, memberId, displayName: name });
      if (!res.ok) {
        showI18nError(t, res.error ?? 'errors.unknown');
        return;
      }
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onClose={() => onOpenChange(false)} title={t('members.rename')}>
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
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? t('common.saving') : t('common.save')}
          </Button>
        </footer>
      </form>
    </Dialog>
  );
}

/**
 * Pencil button that opens the rename dialog.
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
  const t = useTranslations();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => setOpen(true)}
        aria-label={t('members.rename')}
        title={t('members.rename')}
      >
        <Pencil />
      </Button>

      <MemberRenameDialog
        groupId={groupId}
        memberId={memberId}
        currentName={currentName}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
