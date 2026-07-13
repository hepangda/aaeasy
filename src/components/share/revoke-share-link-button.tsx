import { useTransition } from 'react';
import { useTranslations } from 'use-intl';
import { Button } from '@/components/ui/button';
import { revokeShareLinkAction } from '@/spa/actions/shares';

export function RevokeShareLinkButton({
  groupId,
  shareLinkId,
}: {
  groupId: string;
  shareLinkId: string;
}) {
  const t = useTranslations('share');
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          await revokeShareLinkAction({ groupId, shareLinkId });
        });
      }}
    >
      {t('revoke')}
    </Button>
  );
}
