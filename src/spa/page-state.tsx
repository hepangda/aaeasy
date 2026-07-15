import Link from '@/compat/link';
import { useLocation } from 'react-router';
import { useTranslations } from 'use-intl';
import { ArrowLeft, CircleAlert, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function LoadingPage() {
  const t = useTranslations('common');

  return (
    <section
      role="status"
      aria-live="polite"
      className="bg-background text-foreground flex min-h-72 w-full flex-1 items-center justify-center px-6 py-16"
    >
      <div className="flex flex-col items-center gap-4">
        <span
          aria-hidden
          className="text-primary-ink size-7 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none"
        />
        <p className="text-muted-foreground text-sm">{t('loading')}</p>
      </div>
    </section>
  );
}

export function ErrorPage({ error }: { error?: unknown }) {
  const t = useTranslations();
  const location = useLocation();
  const errorStatus =
    error && typeof error === 'object' && 'status' in error ? Number(error.status) : undefined;
  const status = errorStatus ?? (location.pathname === '/404' ? 404 : undefined);
  const content =
    status === 403
      ? {
          code: '403',
          title: t('errors.page_forbidden_title'),
          description: t('errors.page_forbidden_description'),
        }
      : status === 404
        ? {
            code: '404',
            title: t('errors.page_not_found_title'),
            description: t('errors.page_not_found_description'),
          }
        : {
            code: '!',
            title: t('errors.page_generic_title'),
            description: t('errors.page_generic_description'),
          };

  return (
    <section className="bg-background text-foreground flex min-h-[28rem] w-full flex-1 items-center px-4 py-12 sm:px-6 sm:py-16">
      <div className="mx-auto flex w-full max-w-md flex-col items-center text-center">
        <span className="bg-secondary text-secondary-foreground grid size-12 place-items-center rounded-xl">
          <CircleAlert className="size-5" aria-hidden="true" />
        </span>
        <p className="text-muted-foreground mt-5 font-mono text-xs font-semibold tracking-[0.12em]">
          {content.code === '!' ? 'AAEasy' : content.code}
        </p>
        <h1 className="mt-3 text-3xl leading-tight font-semibold tracking-[-0.04em]">
          {content.title}
        </h1>
        <p className="text-muted-foreground mt-3 text-sm leading-6">{content.description}</p>

        <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
          {status === undefined ? (
            <Button type="button" onClick={() => window.location.reload()}>
              <RefreshCw aria-hidden="true" />
              {t('common.retry')}
            </Button>
          ) : null}
          <Button asChild variant={status === undefined ? 'outline' : 'default'}>
            <Link href="/">
              <ArrowLeft /> {t('common.back_home')}
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
