import { useTranslations } from 'use-intl';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAsyncAction } from '@/hooks/use-async-action';
import { removeMemberAction } from '@/spa/actions/groups';

export function RemoveMemberButton({ groupId, memberId }: { groupId: string; memberId: string }) {
  const t = useTranslations();
  const { run, pending } = useAsyncAction({
    action: () => removeMemberAction({ groupId, memberId }),
    confirm: { message: t('members.confirm_remove') },
  });

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
