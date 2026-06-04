'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { leaveGroupAction } from '@/lib/groups/actions';

export function LeaveGroupButton({ groupId }: { groupId: string }) {
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
        if (!(await confirm({ message: t('groups.confirm_leave') }))) return;
        startTransition(async () => {
          const res = await leaveGroupAction(groupId);
          if (res.ok) {
            router.push('/groups');
            router.refresh();
          } else {
            await confirm({ message: t(res.error ?? 'errors.unknown') });
          }
        });
      }}
    >
      <LogOut className="text-destructive" /> {t('groups.leave')}
    </Button>
  );
}
