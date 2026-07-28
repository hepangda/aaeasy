import { useTranslations } from 'use-intl';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAsyncAction } from '@/hooks/use-async-action';
import { deleteGroupAction } from '@/spa/actions/groups';

export function DeleteGroupButton({ groupId }: { groupId: string }) {
  const t = useTranslations();
  const { run, pending } = useAsyncAction({
    action: () => deleteGroupAction(groupId),
    confirm: { message: t('groups.confirm_delete') },
    redirectTo: '/groups',
  });

  return (
    <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => void run()}>
      <Trash2 className="text-destructive-ink" aria-hidden="true" /> {t('groups.delete')}
    </Button>
  );
}
