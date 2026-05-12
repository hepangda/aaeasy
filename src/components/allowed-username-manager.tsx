'use client';

import { useActionState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Trash2 } from 'lucide-react';
import {
  addAllowedUsernameAction,
  deleteAllowedUsernameAction,
  type AdminActionState,
} from '@/lib/admin/actions';
import { showI18nError } from '@/lib/ui/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const initialState: AdminActionState = { ok: false };

export function AllowedUsernameManager({
  usernames,
  initialUsernames = [],
}: {
  usernames: string[];
  initialUsernames?: string[];
}) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(addAllowedUsernameAction, initialState);
  const usernameItems = [...new Set([...usernames, ...initialUsernames])]
    .sort((a, b) => a.localeCompare(b))
    .map((username) => ({
      username,
      fromDb: usernames.includes(username),
      fromEnv: initialUsernames.includes(username),
    }));

  useEffect(() => {
    const fieldKey = state.fieldErrors?.username;
    if (fieldKey) showI18nError(t, fieldKey);
    else if (state.error) showI18nError(t, state.error);
  }, [state, t]);

  return (
    <div className="flex flex-col gap-6">
      <form action={formAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="grid flex-1 gap-2">
          <Label htmlFor="allowed-username">{t('admin.username_label')}</Label>
          <Input
            id="allowed-username"
            name="username"
            required
            minLength={3}
            maxLength={32}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder={t('admin.username_placeholder')}
          />
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? t('common.saving') : t('admin.add_username')}
        </Button>
      </form>

      {usernameItems.length === 0 ? (
        <p className="text-muted-foreground rounded-md border border-dashed px-4 py-6 text-center text-sm">
          {t('admin.username_empty')}
        </p>
      ) : (
        <ul className="divide-y rounded-md border">
          {usernameItems.map((item) => (
            <li
              key={item.username}
              className="flex items-center justify-between gap-4 px-4 py-3 text-sm"
            >
              <span className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="font-medium">@{item.username}</span>
                {item.fromEnv && (
                  <span className="text-muted-foreground rounded border px-1.5 py-0.5 text-xs">
                    {t('admin.username_source_env')}
                  </span>
                )}
                {item.fromDb && (
                  <span className="text-muted-foreground rounded border px-1.5 py-0.5 text-xs">
                    {t('admin.username_source_db')}
                  </span>
                )}
              </span>
              {item.fromDb ? (
                <form action={deleteAllowedUsernameAction}>
                  <input type="hidden" name="username" value={item.username} />
                  <Button
                    type="submit"
                    size="icon"
                    variant="ghost"
                    aria-label={t('admin.delete_username')}
                  >
                    <Trash2 />
                  </Button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
