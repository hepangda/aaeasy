import { useTranslations } from 'use-intl';
import { Unlock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAsyncAction } from '@/hooks/use-async-action';
import { reopenSettlementAction } from '@/spa/actions/settlements';

export function ReopenSettlementButton({ settlementId }: { settlementId: string }) {
  const t = useTranslations('settlements');
  const { run, pending } = useAsyncAction({
    action: () => reopenSettlementAction({ settlementId }),
    confirm: { message: t('reopen_confirm'), destructive: false },
  });

  return (
    <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => void run()}>
      <Unlock aria-hidden="true" /> {pending ? t('reopening') : t('reopen')}
    </Button>
  );
}
