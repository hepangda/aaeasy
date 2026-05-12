'use client';

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { revokeShareLinkAction } from '@/lib/groups/share-actions';

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
