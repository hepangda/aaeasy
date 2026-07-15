import { useTransition } from 'react';
import { useRouter } from '@/compat/navigation';
import { useTranslations } from 'use-intl';
import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { leaveGroupAction } from '@/spa/actions/groups';
import { showI18nError } from '@/lib/ui/toast';

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
            showI18nError(t, res.error ?? 'errors.unknown');
          }
        });
      }}
    >
      <LogOut className="text-destructive-ink" /> {t('groups.leave')}
    </Button>
  );
}
