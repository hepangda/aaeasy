'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { deletePasswordAction } from '@/lib/auth/actions';

export function PasswordDeleteButton({ credentialId }: { credentialId: string }) {
  const t = useTranslations('account');
  const confirm = useConfirm();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={async () => {
        if (!(await confirm({ message: t('password_delete_confirm') }))) return;
        startTransition(async () => {
          await deletePasswordAction(credentialId);
          router.refresh();
        });
      }}
      aria-label={t('password_delete_action')}
    >
      <Trash2 className="text-destructive" />
    </Button>
  );
}
