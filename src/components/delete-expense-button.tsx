'use client';

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { softDeleteExpenseAction } from '@/lib/expenses/actions';

export function DeleteExpenseButton({
  groupId,
  expenseId,
}: {
  groupId: string;
  expenseId: string;
}) {
  const t = useTranslations('expenses');
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
          await softDeleteExpenseAction({ groupId, expenseId });
        });
      }}
      aria-label={t('delete')}
    >
      <Trash2 className="text-destructive" />
    </Button>
  );
}
