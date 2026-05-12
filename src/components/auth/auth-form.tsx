'use client';

import Link from 'next/link';
import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { loginAction, registerAction, type AuthState } from '@/lib/auth/actions';
import { showI18nError } from '@/lib/ui/toast';

const initialState: AuthState = { ok: false };

/**
 * Username + password form. Used by `/login` (primary at the bottom of
 * the page, below the passkey button) and as the password fallback in
 * register flows.
 *
 * The server actions return AuthState with `redirectTo` instead of
 * calling `redirect()` so the client can navigate after follow-up work
 * (e.g. enroll a passkey post-register).
 */
export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const t = useTranslations();
  const router = useRouter();
  const action = mode === 'login' ? loginAction : registerAction;
  const [state, formAction, pending] = useActionState(action, initialState);

  // When the server returns a redirect target, navigate. We use replace
  // so the back button doesn't go back to the auth page.
  useEffect(() => {
    if (state.ok && state.redirectTo) {
      router.replace(state.redirectTo);
      router.refresh();
    }
  }, [state.ok, state.redirectTo, router]);

  // Surface validation and global errors as toasts so the form stays clean.
  useEffect(() => {
    const fieldKey =
      state.fieldErrors?.username ?? state.fieldErrors?.password ?? null;
    if (fieldKey) showI18nError(t, fieldKey);
    else if (state.error) showI18nError(t, state.error);
  }, [state, t]);

  return (
    <form action={formAction} className="flex w-full max-w-sm flex-col gap-5">
      <div className="grid gap-2">
        <Label htmlFor="username">{t('auth.username')}</Label>
        <Input
          id="username"
          name="username"
          required
          minLength={3}
          maxLength={32}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="password">{t('auth.password')}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          maxLength={256}
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
        />
      </div>

      <Button type="submit" variant="outline" disabled={pending} className="mt-2">
        {pending
          ? t('auth.submitting')
          : mode === 'login'
            ? t('auth.submit_login')
            : t('auth.submit_register')}
      </Button>

      {mode === 'login' && (
        <p className="text-muted-foreground text-center text-sm">
          {t('auth.no_account')}{' '}
          <Link
            href="/register"
            className="text-foreground underline-offset-4 hover:underline"
          >
            {t('auth.to_register')}
          </Link>
        </p>
      )}
    </form>
  );
}
