import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { useTranslations } from 'use-intl';
import Link from '@/router/link';
import { Button } from '@/components/ui/button';
import { safeInternalPath } from '../navigation';
import { LoadingPage } from '../page-state';

/** How long to wait before assuming the external redirect isn't coming. */
const STALL_TIMEOUT_MS = 6000;

function ExternalLoginRedirect() {
  const t = useTranslations();
  const [searchParams] = useSearchParams();
  const [stalled, setStalled] = useState(false);
  const next = safeInternalPath(searchParams.get('next'));
  const target = next ? `/api/auth/login?next=${encodeURIComponent(next)}` : '/api/auth/login';

  useEffect(() => {
    window.location.replace(target);
  }, [target]);

  // If the identity provider is down the replace() never completes and the user
  // is left staring at a spinner with no way out — or worse, bounces back here
  // and gets redirected again. Surface an escape hatch instead.
  useEffect(() => {
    const timer = window.setTimeout(() => setStalled(true), STALL_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, []);

  if (!stalled) return <LoadingPage />;

  return (
    <section className="flex w-full flex-1 items-center px-4 py-12 sm:px-6 sm:py-16">
      <div className="mx-auto flex w-full max-w-md flex-col items-center text-center">
        <h1 className="font-display tracking-display text-3xl leading-tight font-bold">
          {t('errors.login_stalled_title')}
        </h1>
        <p className="text-muted-foreground mt-3 text-sm leading-6">
          {t('errors.login_stalled_description')}
        </p>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
          <Button type="button" onClick={() => window.location.replace(target)}>
            <RefreshCw aria-hidden="true" />
            {t('common.retry')}
          </Button>
          <Button asChild variant="outline">
            <Link href="/">
              <ArrowLeft aria-hidden="true" /> {t('common.back_home')}
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

export function LoginPage() {
  return <ExternalLoginRedirect />;
}
