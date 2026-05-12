'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  startRegistration as startWebAuthnRegistration,
  browserSupportsWebAuthn,
} from '@simplewebauthn/browser';
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser';
import { KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  registerAction,
  registerNoPasswordAction,
  type AuthState,
} from '@/lib/auth/actions';
import { showI18nError } from '@/lib/ui/toast';

type Mode = 'passkey' | 'password';
type Phase = 'idle' | 'creating' | 'enrolling' | 'error' | 'done';

interface FieldErrors {
  username?: string;
  password?: string;
  _?: string;
}

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const j: { error?: string } = await res.json().catch(() => ({}));
    throw new Error(j.error ?? `HTTP_${res.status}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Passkey-first registration form. The default flow is:
 *   1. User picks username.
 *   2. We submit to `registerNoPasswordAction` (creates user with no
 *      password hash, display name defaults to username).
 *   3. We immediately invoke WebAuthn `navigator.credentials.create()`
 *      and POST the result to `/api/webauthn/register/verify`.
 *   4. On enroll success, navigate home.
 *
 * If the browser doesn't support WebAuthn (or the user opts out via the
 * "use a password instead" toggle), we fall back to the legacy password
 * register flow.
 */
export function RegisterForm() {
  const t = useTranslations();
  const router = useRouter();

  const [mode, setMode] = useState<Mode>('passkey');
  const [phase, setPhase] = useState<Phase>('idle');
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  // Surface any server-side errors as toasts; UI inputs stay clean.
  useEffect(() => {
    const fieldKey = fieldErrors.username ?? fieldErrors.password ?? fieldErrors._;
    if (fieldKey) showI18nError(t, fieldKey);
    else if (errorKey) showI18nError(t, errorKey);
  }, [errorKey, fieldErrors, t]);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  // Detect WebAuthn support after mount (SSR-safe). If unsupported, force
  // the password fallback.
  const [supportsWebAuthn, setSupportsWebAuthn] = useState<boolean | null>(null);
  useEffect(() => {
    const ok = browserSupportsWebAuthn();
    setSupportsWebAuthn(ok);
    if (!ok) setMode('password');
  }, []);

  const formRef = useRef<HTMLFormElement>(null);

  function applyState(state: AuthState | null): boolean {
    if (!state) return false;
    setFieldErrors(state.fieldErrors ?? {});
    setErrorKey(state.error ?? null);
    return state.ok;
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (phase === 'creating' || phase === 'enrolling') return;
    setErrorKey(null);
    setFieldErrors({});
    const fd = new FormData(formRef.current!);
    fd.set('username', username);

    if (mode === 'password') {
      setPhase('creating');
      fd.set('password', password);
      const state = await registerAction({ ok: false }, fd);
      if (!applyState(state)) {
        setPhase('error');
        return;
      }
      // Server returns redirectTo on success.
      router.replace(state.redirectTo ?? '/');
      router.refresh();
      setPhase('done');
      return;
    }

    // Passkey flow.
    setPhase('creating');
    const created = await registerNoPasswordAction({ ok: false }, fd);
    if (!applyState(created)) {
      setPhase('error');
      return;
    }

    setPhase('enrolling');
    try {
      const init = await postJson<{
        challengeId: string;
        options: PublicKeyCredentialCreationOptionsJSON;
      }>('/api/webauthn/register/options');
      const response = await startWebAuthnRegistration({ optionsJSON: init.options });
      await postJson('/api/webauthn/register/verify', {
        challengeId: init.challengeId,
        response,
        deviceLabel:
          typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
      });
      setPhase('done');
      router.replace('/');
      router.refresh();
    } catch (e) {
      // The user is created and signed in but has no passkey AND no
      // password. We send them to /account where they can either retry
      // passkey enrollment or set a password.
      setPhase('error');
      setErrorKey('errors.passkey_enroll_failed');
      // Surface the underlying message in the developer console for
      // troubleshooting; UI shows the generic key.
      console.error('Passkey enrollment failed', e);
      router.replace('/account');
      router.refresh();
    }
  }

  return (
    <form
      ref={formRef}
      onSubmit={submit}
      className="flex w-full max-w-sm flex-col gap-5"
      noValidate
    >
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
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
      </div>

      {mode === 'password' && (
        <div className="grid gap-2">
          <Label htmlFor="password">{t('auth.password')}</Label>
          <Input
            id="password"
            name="password"
            type="password"
            required
            minLength={8}
            maxLength={256}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
      )}

      <Button
        type="submit"
        className="mt-1"
        disabled={phase === 'creating' || phase === 'enrolling' || phase === 'done'}
      >
        {mode === 'passkey' && <KeyRound />}{' '}
        {phase === 'enrolling'
          ? t('auth.passkey_prompting')
          : phase === 'creating'
            ? t('auth.submitting')
            : mode === 'passkey'
              ? t('auth.register_with_passkey')
              : t('auth.submit_register')}
      </Button>

      {supportsWebAuthn && (
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground -mt-2 text-center text-xs underline-offset-4 hover:underline"
          onClick={() => {
            setErrorKey(null);
            setFieldErrors({});
            setMode((m) => (m === 'passkey' ? 'password' : 'passkey'));
          }}
        >
          {mode === 'passkey'
            ? t('auth.use_password_instead')
            : t('auth.use_passkey_instead')}
        </button>
      )}

      <p className="text-muted-foreground text-center text-sm">
        {t('auth.have_account')}{' '}
        <Link
          href="/login"
          className="text-foreground underline-offset-4 hover:underline"
        >
          {t('auth.to_login')}
        </Link>
      </p>
    </form>
  );
}
