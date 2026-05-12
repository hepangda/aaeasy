'use client';

import { useActionState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { createGroupAction, type ActionState } from '@/lib/groups/actions';
import { showI18nError } from '@/lib/ui/toast';

const initial: ActionState = { ok: false };

export function NewGroupForm() {
  const t = useTranslations();
  const [state, action, pending] = useActionState(createGroupAction, initial);

  useEffect(() => {
    if (state.error) showI18nError(t, state.error);
  }, [state.error, t]);

  return (
    <form action={action} className="flex w-full max-w-lg flex-col gap-5">
      <div className="grid gap-2">
        <Label htmlFor="name">{t('groups.name')}</Label>
        <Input
          id="name"
          name="name"
          required
          maxLength={64}
          placeholder={t('groups.name_placeholder')}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="defaultCurrency">{t('groups.default_currency')}</Label>
        <Input
          id="defaultCurrency"
          name="defaultCurrency"
          defaultValue="CNY"
          maxLength={3}
          minLength={3}
          className="uppercase"
          required
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="members">{t('groups.initial_members')}</Label>
        <Textarea
          id="members"
          name="members"
          rows={4}
          placeholder={t('groups.initial_members_placeholder')}
        />
      </div>

      <Button type="submit" disabled={pending} className="self-start">
        {pending ? t('groups.creating') : t('groups.create')}
      </Button>
    </form>
  );
}
