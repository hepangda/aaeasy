import { useTransition } from 'react';
import { useTranslations } from 'use-intl';
import { useRouter } from '@/compat/navigation';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { softDeleteExpenseAction } from '@/spa/actions/expenses';
import { showI18nError } from '@/lib/ui/toast';

export function DeleteExpenseButton({
  groupId,
  expenseId,
}: {
  groupId: string;
  expenseId: string;
}) {
  const t = useTranslations('expenses');
  const tRoot = useTranslations();
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      className="size-8"
      disabled={pending}
      onClick={async () => {
        if (!(await confirm({ message: t('confirm_delete') }))) return;
        startTransition(async () => {
          const result = await softDeleteExpenseAction({ groupId, expenseId });
          if (!result.ok) {
            showI18nError(tRoot, result.error ?? 'errors.unknown');
            return;
          }
          router.refresh();
        });
      }}
      aria-label={t('delete')}
    >
      <Trash2 className="text-destructive-ink" />
    </Button>
  );
}
