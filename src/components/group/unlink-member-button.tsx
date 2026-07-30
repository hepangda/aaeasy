import { useTranslations } from 'use-intl';
import { Unlink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { useAsyncAction } from '@/hooks/use-async-action';
import { unlinkMemberAction } from '@/spa/actions/groups';

function useUnlinkMember(groupId: string, memberId: string) {
  const t = useTranslations('members');
  return useAsyncAction({
    action: () => unlinkMemberAction({ groupId, memberId }),
    confirm: { message: t('confirm_unlink') },
  });
}

export function UnlinkMemberButton({ groupId, memberId }: { groupId: string; memberId: string }) {
  const t = useTranslations('members');
  const { run, pending } = useUnlinkMember(groupId, memberId);

  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      disabled={pending}
      onClick={() => void run()}
      aria-label={t('unlink')}
      title={t('unlink')}
    >
      <Unlink aria-hidden="true" />
    </Button>
  );
}

/** Same action, rendered as a row inside an overflow menu. */
export function UnlinkMemberMenuItem({ groupId, memberId }: { groupId: string; memberId: string }) {
  const t = useTranslations('members');
  const { run, pending } = useUnlinkMember(groupId, memberId);

  return (
    <DropdownMenuItem
      disabled={pending}
      onSelect={(event) => {
        // Keep the menu mounted while the confirm dialog resolves.
        event.preventDefault();
        void run();
      }}
      className="gap-2"
    >
      <Unlink className="size-4" aria-hidden="true" />
      {t('unlink')}
    </DropdownMenuItem>
  );
}
