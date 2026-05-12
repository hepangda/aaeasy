'use client';

import { useEffect, useState } from 'react';
import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { setDisplayNameAction, type AccountActionState } from '@/lib/auth/account-actions';
import { showI18nError } from '@/lib/ui/toast';

const initialState: AccountActionState = { ok: false };

export function SetDisplayNameForm({ currentDisplayName }: { currentDisplayName: string }) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(setDisplayNameAction, initialState);
  const [showSaved, setShowSaved] = useState(false);

  // Show "Saved" feedback for 2.5s after success
  if (state.ok && !showSaved) {
    setShowSaved(true);
    setTimeout(() => setShowSaved(false), 2500);
  }

  useEffect(() => {
    const fieldKey = state.fieldErrors?.displayName;
    if (fieldKey) showI18nError(t, fieldKey);
    else if (state.error) showI18nError(t, state.error);
  }, [state, t]);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="grid gap-2">
        <Label htmlFor="displayName">{t('account.display_name_label')}</Label>
        <Input
          id="displayName"
          name="displayName"
          maxLength={64}
          defaultValue={currentDisplayName}
          disabled={pending}
          placeholder={t('account.display_name_placeholder')}
        />
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={pending} size="sm">
          {pending ? t('common.saving') : t('common.save')}
        </Button>
        {showSaved && (
          <p className="text-muted-foreground flex items-center text-sm">
            ✓ {t('account.saved')}
          </p>
        )}
      </div>
    </form>
  );
}
