'use client';

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { deletePasskeyAction } from '@/lib/auth/passkey-actions';

export function PasskeyDeleteButton({ credentialId }: { credentialId: string }) {
  const t = useTranslations('passkey');
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={async () => {
        if (!(await confirm({ message: t('confirm_delete') }))) return;
        startTransition(async () => {
          await deletePasskeyAction(credentialId);
        });
      }}
      aria-label={t('delete')}
    >
      <Trash2 className="text-destructive" />
    </Button>
  );
}
