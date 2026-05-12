'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { Languages } from 'lucide-react';
import { setLocaleAction } from '@/i18n/actions';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const LANGS = [
  { code: 'zh', label: '中文' },
  { code: 'en', label: 'English' },
] as const;

export function LocaleSwitcher() {
  const current = useLocale();
  const t = useTranslations('common');
  const [isPending, startTransition] = useTransition();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('language')} disabled={isPending}>
          <Languages />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t('language')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {LANGS.map((l) => (
          <DropdownMenuItem
            key={l.code}
            onSelect={() => startTransition(() => setLocaleAction(l.code))}
            className={current === l.code ? 'font-semibold' : ''}
          >
            {l.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
