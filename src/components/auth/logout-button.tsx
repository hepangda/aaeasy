import { useTransition } from 'react';
import { LogOut } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { Button } from '@/components/ui/button';
import { logoutAction } from '@/spa/actions/auth';

export function LogoutButton() {
  const t = useTranslations('common');
  const [isPending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={isPending}
      onClick={() => startTransition(() => logoutAction())}
    >
      <LogOut /> {t('logout')}
    </Button>
  );
}
