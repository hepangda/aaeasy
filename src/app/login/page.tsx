import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { AuthForm } from '@/components/auth-form';
import { PasskeyLoginButton } from '@/components/passkey-buttons';
import { getCurrentSession } from '@/lib/auth/session';

/**
 * Passkey-first login. The passkey button sits at the top as the primary
 * CTA. The username/password form is collapsed into a fallback affordance
 * below the divider — still fully usable, but visually demoted.
 */
export default async function LoginPage() {
  if (await getCurrentSession()) redirect('/');
  const t = await getTranslations();
  return (
    <section className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-8 px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">{t('auth.login_title')}</h1>

      <div className="w-full max-w-sm">
        <PasskeyLoginButton />
      </div>

      <div className="flex w-full max-w-sm items-center gap-3">
        <span className="bg-border h-px flex-1" />
        <span className="text-muted-foreground text-xs uppercase tracking-wide">
          {t('auth.or_with_password')}
        </span>
        <span className="bg-border h-px flex-1" />
      </div>

      <AuthForm mode="login" />
    </section>
  );
}
