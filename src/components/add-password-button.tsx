'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { setPasswordAction, type AuthState } from '@/lib/auth/actions';
import { randomCredentialName } from '@/lib/auth/random-name';
import { showI18nError } from '@/lib/ui/toast';

const initial: AuthState = { ok: false };

/**
 * Always opens a modal that adds a NEW password credential. The label
 * defaults to a random two-word name so multiple credentials are easy to
 * tell apart in the credential list.
 */
export function AddPasswordButton() {
  const router = useRouter();
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(setPasswordAction, initial);
  const [password, setPassword] = useState('');
  const [label, setLabel] = useState('');

  // Generate a fresh suggestion each time the dialog opens.
  const suggestion = useMemo(() => randomCredentialName(), [open]);

  useEffect(() => {
    if (state.ok) {
      setOpen(false);
      setPassword('');
      setLabel('');
      router.refresh();
    }
  }, [state.ok, router]);

  // Surface server-side validation / errors as toasts.
  useEffect(() => {
    if (state.fieldErrors?.password) showI18nError(t, state.fieldErrors.password);
    else if (state.error) showI18nError(t, state.error);
  }, [state, t]);

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <KeyRound /> {t('account.password_add_action')}
      </Button>

      <Dialog open={open} onClose={() => setOpen(false)} title={t('account.password_add_action')}>
        <form action={action} className="flex flex-col gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="add-password-label" className="text-sm">
              {t('account.credential_name_label')}
            </Label>
            <Input
              id="add-password-label"
              name="label"
              type="text"
              maxLength={64}
              placeholder={suggestion}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
            <p className="text-muted-foreground text-xs">
              {t('account.credential_name_hint', { suggestion })}
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="add-password-value" className="text-sm">
              {t('account.password_setup_label')}
            </Label>
            <Input
              id="add-password-value"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              maxLength={256}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <footer className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? t('common.saving') : t('account.password_add_action')}
            </Button>
          </footer>
        </form>
      </Dialog>
    </>
  );
}
