import { useTranslations } from 'use-intl';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { useAsyncAction } from '@/hooks/use-async-action';
import { removeMemberAction } from '@/spa/actions/groups';

function useRemoveMember(groupId: string, memberId: string) {
  const t = useTranslations();
  return useAsyncAction({
    action: () => removeMemberAction({ groupId, memberId }),
    confirm: { message: t('members.confirm_remove') },
  });
}

export function RemoveMemberButton({ groupId, memberId }: { groupId: string; memberId: string }) {
  const t = useTranslations();
  const { run, pending } = useRemoveMember(groupId, memberId);

  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      disabled={pending}
      onClick={() => void run()}
      aria-label={t('members.remove')}
    >
      <Trash2 className="text-destructive-ink" aria-hidden="true" />
    </Button>
  );
}

/** Same action, rendered as a row inside an overflow menu. */
export function RemoveMemberMenuItem({ groupId, memberId }: { groupId: string; memberId: string }) {
  const t = useTranslations();
  const { run, pending } = useRemoveMember(groupId, memberId);

  return (
    <DropdownMenuItem
      disabled={pending}
      onSelect={(event) => {
        // Keep the menu mounted while the confirm dialog resolves.
        event.preventDefault();
        void run();
      }}
      className="text-destructive-ink gap-2"
    >
      <Trash2 className="size-4" aria-hidden="true" />
      {t('members.remove')}
    </DropdownMenuItem>
  );
}
