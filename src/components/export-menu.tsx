'use client';

import { useTranslations } from 'next-intl';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function ExportMenu({ groupId }: { groupId: string }) {
  const t = useTranslations('export');
  return (
    <Button asChild type="button" variant="outline" size="sm">
      <a href={`/api/groups/${groupId}/export`} download>
        <Download /> {t('pdf')}
      </a>
    </Button>
  );
}
