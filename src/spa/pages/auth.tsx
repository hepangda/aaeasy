import { Navigate, useSearchParams } from 'react-router';
import { useTranslations } from 'use-intl';
import { AuthForm } from '@/components/auth/auth-form';
import { PasskeyLoginButton } from '@/components/auth/passkey-buttons';
import { RegisterForm } from '@/components/auth/register-form';
import { LoadingPage } from '../page-state';
import { useSessionQuery } from '../queries';
import { safeInternalPath } from '../navigation';

function AnonymousOnly({
  children,
  redirectTo,
}: {
  children: React.ReactNode;
  redirectTo: string;
}) {
  const session = useSessionQuery();
  if (session.isPending) return <LoadingPage />;
  if (session.data?.user) return <Navigate to={redirectTo} replace />;
  return children;
}

export function LoginPage() {
  const t = useTranslations();
  const [searchParams] = useSearchParams();
  const nextPath = safeInternalPath(searchParams.get('next'));
  return (
    <AnonymousOnly redirectTo={nextPath ?? '/'}>
      <section className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-8 px-6 py-16">
        <h1 className="text-2xl font-semibold tracking-tight">{t('auth.login_title')}</h1>
        <div className="w-full max-w-sm">
          <PasskeyLoginButton requestedPath={nextPath} />
        </div>
        <div className="flex w-full max-w-sm items-center gap-3">
          <span className="bg-border h-px flex-1" />
          <span className="text-muted-foreground text-xs tracking-wide uppercase">
            {t('auth.or_with_password')}
          </span>
          <span className="bg-border h-px flex-1" />
        </div>
        <AuthForm mode="login" requestedPath={nextPath} />
      </section>
    </AnonymousOnly>
  );
}

export function RegisterPage() {
  const t = useTranslations('auth');
  const [searchParams] = useSearchParams();
  const nextPath = safeInternalPath(searchParams.get('next'));
  return (
    <AnonymousOnly redirectTo={nextPath ?? '/'}>
      <section className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-8 px-6 py-16">
        <h1 className="text-2xl font-semibold tracking-tight">{t('register_title')}</h1>
        <RegisterForm requestedPath={nextPath} />
      </section>
    </AnonymousOnly>
  );
}
