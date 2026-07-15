import { useState, useTransition } from 'react';
import { useRouter } from '@/compat/navigation';
import { useTranslations } from 'use-intl';
import { CheckSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { settleAction } from '@/spa/actions/settlements';
import { showI18nError } from '@/lib/ui/toast';

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
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function doSettle() {
    startTransition(async () => {
      const res = await settleAction({ groupId });
      if (res.ok) {
        setOpen(false);
        router.refresh();
      } else {
        showI18nError(t, res.error ?? 'errors.unknown');
      }
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={openExpenseCount === 0}
        onClick={() => setOpen(true)}
      >
        <CheckSquare /> {t('settlements.settle_button')}
      </Button>
      <Dialog
        open={open}
        onClose={() => {
          if (!pending) setOpen(false);
        }}
        title={t('settlements.settle_confirm_title')}
        className="max-w-md"
      >
        <div className="flex flex-col gap-2 text-sm">
          <p className="text-muted-foreground">
            {t('settlements.settle_confirm_desc', { count: openExpenseCount })}
          </p>
          {draftExpenseCount > 0 && (
            <p className="text-destructive-ink">
              {t('settlements.settle_draft_warning', { count: draftExpenseCount })}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
            {t('common.cancel')}
          </Button>
          <Button type="button" disabled={pending} onClick={doSettle}>
            {pending ? t('settlements.settling') : t('settlements.do_settle')}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
