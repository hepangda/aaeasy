import { useTranslations } from 'use-intl';
import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAsyncAction } from '@/hooks/use-async-action';
import { leaveGroupAction } from '@/spa/actions/groups';

export function LeaveGroupButton({ groupId }: { groupId: string }) {
  const t = useTranslations();
  const { run, pending } = useAsyncAction({
    action: () => leaveGroupAction(groupId),
    confirm: { message: t('groups.confirm_leave') },
    redirectTo: '/groups',
  });

  return (
    <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => void run()}>
      <LogOut className="text-destructive-ink" aria-hidden="true" /> {t('groups.leave')}
    </Button>
  );
}
