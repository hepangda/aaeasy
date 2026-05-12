'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { CheckSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { settleAction } from '@/lib/settle/actions';
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
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !pending && setOpen(false)}
        >
          <div
            className="bg-background flex w-full max-w-md flex-col gap-4 rounded-lg border p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <h2 className="text-lg font-medium">{t('settlements.settle_confirm_title')}</h2>
            <div className="flex flex-col gap-2 text-sm">
              <p className="text-muted-foreground">
                {t('settlements.settle_confirm_desc', { count: openExpenseCount })}
              </p>
              {draftExpenseCount > 0 && (
                <p className="text-destructive">
                  {t('settlements.settle_draft_warning', { count: draftExpenseCount })}
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() => setOpen(false)}
              >
                {t('common.cancel')}
              </Button>
              <Button type="button" disabled={pending} onClick={doSettle}>
                {pending ? t('settlements.settling') : t('settlements.do_settle')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
