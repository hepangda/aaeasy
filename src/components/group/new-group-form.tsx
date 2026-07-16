import { useActionState, useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ChipInput, type MemberChip } from '@/components/ui/chip-input';
import { CurrencySelect } from '@/components/money/currency-select';
import { createGroupAction, type ActionState } from '@/spa/actions/groups';
import { showI18nError } from '@/lib/ui/toast';

const initial: ActionState = { ok: false };

export function NewGroupForm() {
  const t = useTranslations();
  const [state, action, pending] = useActionState(createGroupAction, initial);
  const [chips, setChips] = useState<MemberChip[]>([]);
  const [currency, setCurrency] = useState('CNY');

  useEffect(() => {
    if (state.error) showI18nError(t, state.error);
  }, [state.error, t]);

  return (
    <form action={action} className="flex w-full max-w-lg flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
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
          <CurrencySelect
            id="defaultCurrency"
            name="defaultCurrency"
            value={currency}
            onChange={(event) => setCurrency(event.target.value)}
          />
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="members">{t('groups.initial_members')}</Label>
        <ChipInput
          id="members"
          value={chips}
          onChange={setChips}
          placeholder={t('groups.initial_members_chip_hint')}
          ariaLabel={t('groups.initial_members')}
          disabled={pending}
        />
        <p className="text-muted-foreground text-xs">{t('groups.chip_mention_hint')}</p>
        <input type="hidden" name="members" value={chips.length ? JSON.stringify(chips) : ''} />
      </div>

      <Button type="submit" disabled={pending} className="self-start">
        {pending ? t('groups.creating') : t('groups.create')}
      </Button>
    </form>
  );
}
