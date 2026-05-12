'use client';

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { removeMemberAction } from '@/lib/groups/actions';

export function RemoveMemberButton({
  groupId,
  memberId,
}: {
  groupId: string;
  memberId: string;
}) {
  const t = useTranslations('members');
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={async () => {
        if (!(await confirm({ message: t('confirm_remove') }))) return;
        startTransition(async () => {
          await removeMemberAction({ groupId, memberId });
        });
      }}
      aria-label={t('remove')}
    >
      <Trash2 className="text-destructive" />
    </Button>
  );
}
