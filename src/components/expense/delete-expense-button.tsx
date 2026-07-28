import { useTranslations } from 'use-intl';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { useAsyncAction } from '@/hooks/use-async-action';
import { softDeleteExpenseAction } from '@/spa/actions/expenses';

function useDeleteExpense(groupId: string, expenseId: string) {
  const t = useTranslations('expenses');
  return useAsyncAction({
    action: () => softDeleteExpenseAction({ groupId, expenseId }),
    confirm: { message: t('confirm_delete') },
  });
}

export function DeleteExpenseButton({
  groupId,
  expenseId,
}: {
  groupId: string;
  expenseId: string;
}) {
  const t = useTranslations('expenses');
  const { run, pending } = useDeleteExpense(groupId, expenseId);

  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      disabled={pending}
      onClick={() => void run()}
      aria-label={t('delete')}
    >
      <Trash2 className="text-destructive-ink" />
    </Button>
  );
}

/** Same action, rendered as a row inside an overflow menu. */
export function DeleteExpenseMenuItem({
  groupId,
  expenseId,
}: {
  groupId: string;
  expenseId: string;
}) {
  const t = useTranslations('expenses');
  const { run, pending } = useDeleteExpense(groupId, expenseId);

  return (
    <DropdownMenuItem
      disabled={pending}
      onSelect={(event) => {
        // Keep the menu mounted while the confirm dialog resolves.
        event.preventDefault();
        void run();
      }}
      className="text-destructive-ink gap-2"
    >
      <Trash2 className="size-4" aria-hidden="true" />
      {t('delete')}
    </DropdownMenuItem>
  );
}
