import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { CheckSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormDialog } from '@/components/ui/form-dialog';
import { useAsyncAction } from '@/hooks/use-async-action';
import { settleAction } from '@/spa/actions/settlements';

export function SettleButton({
  groupId,
  openExpenseCount,
  draftExpenseCount,
}: {
  groupId: string;
  openExpenseCount: number;
  draftExpenseCount: number;
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const disabled = openExpenseCount === 0;

  const { run, pending } = useAsyncAction({
    action: () => settleAction({ groupId }),
    onSuccess: () => setOpen(false),
  });

  return (
    <>
      <Button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        // A bare disabled button gave no clue why it was inert. The title makes
        // the reason reachable on hover and to assistive tech.
        title={disabled ? t('settlements.settle_disabled_reason') : undefined}
      >
        <CheckSquare aria-hidden="true" /> {t('settlements.settle_button')}
      </Button>

      <FormDialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('settlements.settle_confirm_title')}
        description={t('settlements.settle_confirm_desc', { count: openExpenseCount })}
        onSubmit={() => void run()}
        submitLabel={t('settlements.do_settle')}
        pending={pending}
      >
        {draftExpenseCount > 0 && (
          <p className="text-destructive-ink text-sm" role="alert">
            {t('settlements.settle_draft_warning', { count: draftExpenseCount })}
          </p>
        )}
      </FormDialog>
    </>
  );
}
