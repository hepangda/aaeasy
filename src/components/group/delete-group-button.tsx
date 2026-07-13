import { useTransition } from 'react';
import { useRouter } from '@/compat/navigation';
import { useTranslations } from 'use-intl';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { deleteGroupAction } from '@/spa/actions/groups';

export function DeleteGroupButton({ groupId }: { groupId: string }) {
  const t = useTranslations();
  const confirm = useConfirm();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={async () => {
        if (!(await confirm({ message: t('groups.confirm_delete') }))) return;
        startTransition(async () => {
          const res = await deleteGroupAction(groupId);
          if (res.ok) {
            router.push('/groups');
            router.refresh();
          } else {
            await confirm({ message: t(res.error ?? 'errors.unknown') });
          }
        });
      }}
    >
      <Trash2 className="text-destructive" /> {t('groups.delete')}
    </Button>
  );
}
