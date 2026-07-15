import { useTransition } from 'react';
import { useTranslations } from 'use-intl';
import { useRouter } from '@/compat/navigation';
import { Unlink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { unlinkMemberAction } from '@/spa/actions/groups';
import { showI18nError } from '@/lib/ui/toast';

export function UnlinkMemberButton({ groupId, memberId }: { groupId: string; memberId: string }) {
  const t = useTranslations('members');
  const tRoot = useTranslations();
  const router = useRouter();
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
          const result = await unlinkMemberAction({ groupId, memberId });
          if (!result.ok) {
            showI18nError(tRoot, result.error ?? 'errors.unknown');
            return;
          }
          router.refresh();
        });
      }}
      aria-label={t('unlink')}
      title={t('unlink')}
    >
      <Unlink />
    </Button>
  );
}
