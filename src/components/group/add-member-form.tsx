import { useActionState, useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { addMemberAction, type ActionState } from '@/spa/actions/groups';
import { showI18nError } from '@/lib/ui/toast';

const initial: ActionState = { ok: false };

export function AddMemberForm({ groupId }: { groupId: string }) {
  const t = useTranslations();
  const [state, submit, pending] = useActionState(addMemberAction, initial);
  const [displayName, setDisplayName] = useState('');

  useEffect(() => {
    if (state.error) showI18nError(t, state.error);
  }, [state.error, t]);

  useEffect(() => {
    if (state.ok) setDisplayName('');
  }, [state.ok]);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit({ groupId, displayName });
      }}
      className="flex flex-col gap-2 sm:flex-row sm:items-end"
    >
      <div className="flex-1">
        <Input
          name="displayName"
          aria-label={t('members.add_placeholder')}
          required
          maxLength={40}
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          placeholder={t('members.add_placeholder')}
        />
      </div>
      <Button type="submit" disabled={pending}>
        <Plus /> {pending ? t('members.adding') : t('members.add')}
      </Button>
    </form>
  );
}
