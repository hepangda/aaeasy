import { useTranslations } from 'use-intl';
import { Unlink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAsyncAction } from '@/hooks/use-async-action';
import { unlinkMemberAction } from '@/spa/actions/groups';

export function UnlinkMemberButton({ groupId, memberId }: { groupId: string; memberId: string }) {
  const t = useTranslations('members');
  const { run, pending } = useAsyncAction({
    action: () => unlinkMemberAction({ groupId, memberId }),
    confirm: { message: t('confirm_unlink') },
  });

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
