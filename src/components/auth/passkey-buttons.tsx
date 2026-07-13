import { useEffect, useState, useTransition } from 'react';
import { useRouter } from '@/compat/navigation';
import { useTranslations } from 'use-intl';
import {
  startRegistration as startWebAuthnRegistration,
  startAuthentication as startWebAuthnAuthentication,
  browserSupportsWebAuthn,
} from '@simplewebauthn/browser';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import { KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { errorToast } from '@/lib/ui/toast';
import { authRedirect } from '@/spa/navigation';

type Status = 'idle' | 'working' | 'error' | 'success';

type EnrollResult = {
  challengeId: string;
  options: PublicKeyCredentialCreationOptionsJSON;
};
type AuthResult = {
  challengeId: string;
  options: PublicKeyCredentialRequestOptionsJSON;
};

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

export function PasskeyEnrollButton({ deviceLabel }: { deviceLabel?: string }) {
  const t = useTranslations('passkey');
  const router = useRouter();
  const [status, setStatus] = useState<Status>('idle');
  const [pending, startTransition] = useTransition();
  const [supported, setSupported] = useState<boolean | null>(null);

  useEffect(() => {
    setSupported(browserSupportsWebAuthn());
  }, []);

  async function enroll() {
    setStatus('working');
    try {
      const init = await postJson<EnrollResult>('/api/auth/webauthn/register/options');
      const response = await startWebAuthnRegistration({ optionsJSON: init.options });
      await postJson('/api/auth/webauthn/register/verify', {
        challengeId: init.challengeId,
        response,
        deviceLabel,
      });
      setStatus('success');
      startTransition(() => router.refresh());
    } catch (e) {
      setStatus('error');
      errorToast(`${t('error_prefix')}: ${e instanceof Error ? e.message : 'unknown'}`);
    }
  }

  // Defer the support probe to the client so SSR markup matches the
  // first client paint (avoids hydration mismatch).
  if (supported === null) return null;
  if (!supported) {
    return <p className="text-muted-foreground text-sm">{t('not_supported')}</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="outline"
        onClick={enroll}
        disabled={status === 'working' || pending}
      >
        <KeyRound /> {status === 'working' ? t('enrolling') : t('add_passkey')}
      </Button>
      {status === 'success' && <p className="text-sm text-emerald-600">{t('enrolled')}</p>}
    </div>
  );
}

export function PasskeyLoginButton({ requestedPath }: { requestedPath?: string | null }) {
  const t = useTranslations('passkey');
  const router = useRouter();
  const [status, setStatus] = useState<Status>('idle');
  const [supported, setSupported] = useState<boolean | null>(null);

  useEffect(() => {
    setSupported(browserSupportsWebAuthn());
  }, []);

  async function signIn() {
    setStatus('working');
    try {
      const init = await postJson<AuthResult>('/api/auth/webauthn/login/options');
      const response = await startWebAuthnAuthentication({ optionsJSON: init.options });
      const verify = await postJson<{ ok: true; redirectTo: string }>(
        '/api/auth/webauthn/login/verify',
        {
          challengeId: init.challengeId,
          response,
        },
      );
      setStatus('success');
      router.replace(authRedirect(verify.redirectTo, requestedPath));
      router.refresh();
    } catch (e) {
      setStatus('error');
      errorToast(`${t('error_prefix')}: ${e instanceof Error ? e.message : 'unknown'}`);
    }
  }

  // Same SSR-safe gating pattern as the enroll button above.
  if (!supported) return null;

  return (
    <div className="flex w-full flex-col gap-2">
      <Button type="button" onClick={signIn} disabled={status === 'working'}>
        <KeyRound /> {status === 'working' ? t('verifying') : t('sign_in_with_passkey')}
      </Button>
    </div>
  );
}
