'use client';

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { deleteGroupAction } from '@/lib/groups/actions';

export function DeleteGroupButton({ groupId }: { groupId: string }) {
  const t = useTranslations('groups');
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={async () => {
        if (!(await confirm({ message: t('confirm_delete') }))) return;
        startTransition(async () => {
          await deleteGroupAction(groupId);
        });
      }}
    >
      <Trash2 className="text-destructive" /> {t('delete')}
    </Button>
  );
}
