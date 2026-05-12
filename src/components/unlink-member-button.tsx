'use client';

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Unlink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { unlinkMemberAction } from '@/lib/groups/actions';

export function UnlinkMemberButton({
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
        if (!(await confirm({ message: t('confirm_unlink') }))) return;
        startTransition(async () => {
          await unlinkMemberAction({ groupId, memberId });
        });
      }}
      aria-label={t('unlink')}
      title={t('unlink')}
    >
      <Unlink />
    </Button>
  );
}
