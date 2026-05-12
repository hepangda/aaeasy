'use client';

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Unlock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { reopenSettlementAction } from '@/lib/settle/reopen-action';
import { showI18nError } from '@/lib/ui/toast';

export function ReopenSettlementButton({ settlementId }: { settlementId: string }) {
  const t = useTranslations('settlements');
  const tFull = useTranslations();
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();

  async function onClick() {
    if (!(await confirm({ message: t('reopen_confirm'), destructive: false }))) return;
    startTransition(async () => {
      const res = await reopenSettlementAction({ settlementId });
      if (!res.ok) showI18nError(tFull, res.error ?? 'errors.unknown');
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <Button type="button" variant="outline" size="sm" disabled={pending} onClick={onClick}>
        <Unlock /> {pending ? t('reopening') : t('reopen')}
      </Button>
    </div>
  );
}
