'use client';

import { useActionState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { addMemberAction, type ActionState } from '@/lib/groups/actions';
import { showI18nError } from '@/lib/ui/toast';

const initial: ActionState = { ok: false };

export function AddMemberForm({ groupId }: { groupId: string }) {
  const t = useTranslations();
  const [state, action, pending] = useActionState(addMemberAction, initial);

  useEffect(() => {
    if (state.error) showI18nError(t, state.error);
  }, [state.error, t]);

  return (
    <form action={action} className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <input type="hidden" name="groupId" value={groupId} />
      <div className="flex-1">
        <Input
          name="displayName"
          required
          maxLength={40}
          placeholder={t('members.add_placeholder')}
        />
      </div>
      <Button type="submit" disabled={pending}>
        <Plus /> {pending ? t('members.adding') : t('members.add')}
      </Button>
    </form>
  );
}
