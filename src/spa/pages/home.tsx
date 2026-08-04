import Link from '@/router/link';
import { ArrowRight, ReceiptText } from 'lucide-react';
import { Navigate } from 'react-router';
import { useTranslations } from 'use-intl';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useSessionQuery } from '../queries';

const DEMO_AVATARS = [
  { initial: 'L', className: 'bg-signal text-signal-foreground' },
  { initial: 'Y', className: 'bg-positive text-positive-foreground' },
  { initial: 'Z', className: 'bg-primary text-primary-foreground' },
] as const;

const DEMO_BALANCES = [
  { name: 'Lee', amount: '+¥222', className: 'text-positive-ink' },
  { name: 'Lin', amount: '−¥168', className: 'text-primary-ink' },
  { name: 'Yuki', amount: '−¥54', className: 'text-primary-ink' },
] as const;

const DEMO_TRANSFERS = [
  { route: 'Lin → Lee', amount: '¥168' },
  { route: 'Yuki → Lee', amount: '¥54' },
] as const;

function DemoAvatars() {
  return (
    <div className="flex [&>*+*]:-ml-2" aria-hidden="true">
      {DEMO_AVATARS.map((avatar) => (
        <span
          key={avatar.initial}
          className={cn(
            'border-card grid size-8 place-items-center rounded-full border-[3px] font-mono text-[9px] font-bold',
            avatar.className,
          )}
        >
          {avatar.initial}
        </span>
      ))}
    </div>
  );
}

function LedgerPreview() {
  const t = useTranslations('home');

  return (
    <div className="relative isolate w-full lg:min-h-[32rem]" aria-label={t('demo_balance')}>
      <div
        aria-hidden="true"
        className="border-primary/15 bg-secondary absolute inset-[3.75rem_1.75rem_2.25rem_4rem] hidden rotate-[2.5deg] rounded-2xl border sm:block"
      />

      <div className="interface-enter-delayed border-border bg-card shadow-lifted relative overflow-hidden rounded-2xl border">
        <div className="border-border flex items-center justify-between gap-4 border-b px-5 py-5 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className="bg-primary text-primary-foreground grid size-9 shrink-0 place-items-center rounded-lg">
              <ReceiptText className="size-4" aria-hidden="true" />
            </span>
            <p className="tracking-title truncate text-sm font-bold sm:text-base">
              {t('demo_group')}
            </p>
          </div>
          <DemoAvatars />
        </div>

        <div className="grid md:grid-cols-[1.04fr_0.96fr]">
          <section className="border-border p-5 sm:p-6 md:border-r">
            <p className="text-muted-foreground mb-4 text-[10px] font-bold tracking-[0.13em] uppercase">
              {t('feature_capture_title')}
            </p>

            <div className="border-border rounded-xl border p-4">
              <div className="flex items-start gap-3">
                <span className="bg-secondary text-primary-ink grid size-9 shrink-0 place-items-center rounded-lg">
                  <ReceiptText className="size-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">{t('demo_expense')}</p>
                  <p className="text-muted-foreground mt-1 text-xs leading-5">{t('demo_payer')}</p>
                </div>
                <span className="tracking-figure font-mono text-base font-bold">¥438</span>
              </div>

              <div className="border-border mt-4 flex items-center justify-between gap-4 border-t border-dashed pt-3 text-xs">
                <span className="text-muted-foreground">{t('demo_members')}</span>
                <span className="truncate font-semibold">Lin · Yuki · Lee · Mia</span>
              </div>
            </div>
          </section>

          <section className="bg-muted/30 p-5 sm:p-6">
            <p className="text-muted-foreground mb-3 text-[10px] font-bold tracking-[0.13em] uppercase">
              {t('feature_balance_title')}
            </p>

            <dl>
              {DEMO_BALANCES.map((balance) => (
                <div
                  key={balance.name}
                  className="border-border flex items-center justify-between gap-4 border-b py-3 last:border-b-0"
                >
                  <dt className="text-muted-foreground text-xs">{balance.name}</dt>
                  <dd className={cn('font-mono text-xs font-bold', balance.className)}>
                    {balance.amount}
                  </dd>
                </div>
              ))}
            </dl>

            <div className="bg-secondary mt-4 rounded-xl px-4 py-3.5">
              <p className="text-secondary-foreground mb-1.5 text-xs font-bold">
                {t('demo_balance')}
              </p>
              {DEMO_TRANSFERS.map((transfer) => (
                <div
                  key={transfer.route}
                  className="flex items-center justify-between gap-3 py-1.5 text-xs font-semibold"
                >
                  <span>{transfer.route}</span>
                  <span className="text-primary-ink font-mono">{transfer.amount}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

      <div className="bg-sidebar text-sidebar-foreground shadow-lifted interface-enter-delayed absolute -right-4 bottom-2 hidden w-48 rounded-xl px-4 py-3 lg:block">
        <p className="text-xs font-bold">{t('feature_collab_title')}</p>
        <p className="text-sidebar-foreground/58 mt-1 text-[10px] leading-4">
          {t('feature_collab_desc')}
        </p>
      </div>
    </div>
  );
}

function FeatureStep({
  number,
  title,
  description,
}: {
  number: string;
  title: string;
  description: string;
}) {
  return (
    <article className="relative grid min-h-28 grid-cols-[2.5rem_minmax(0,1fr)] gap-6 md:block md:min-h-0 md:pr-12 md:last:pr-0">
      <span className="border-border bg-card text-primary-ink relative z-10 grid size-10 place-items-center rounded-full border font-mono text-[10px] font-bold">
        {number}
      </span>
      <div className="md:mt-6">
        <h2 className="font-display text-foreground tracking-display text-lg font-semibold sm:text-xl">
          {title}
        </h2>
        <p className="text-muted-foreground mt-2 max-w-sm text-sm leading-6">{description}</p>
      </div>
    </article>
  );
}

export function HomePage() {
  const t = useTranslations('home');
  const commonT = useTranslations('common');
  const session = useSessionQuery();

  if (session.data?.user) return <Navigate to="/groups" replace />;

  return (
    <div className="relative isolate flex flex-1 flex-col overflow-hidden">
      <section className="relative grid overflow-hidden">
        <div
          className="border-primary/10 absolute -top-72 -right-72 size-[44rem] rounded-full border"
          aria-hidden="true"
        >
          <span className="border-primary/7 absolute inset-28 rounded-full border" />
          <span className="border-primary/5 absolute inset-56 rounded-full border" />
        </div>

        <div className="mx-auto grid min-h-[calc(100svh-3.5rem)] w-full max-w-7xl items-center gap-12 px-5 py-14 sm:px-8 sm:py-16 lg:min-h-[45rem] lg:grid-cols-[minmax(0,0.82fr)_minmax(36rem,1.18fr)] lg:gap-16 lg:px-10 lg:py-20">
          <div className="interface-enter relative z-10 max-w-xl">
            <h1 className="font-display text-foreground tracking-hero max-w-[10ch] text-[clamp(3.15rem,5.4vw,4.75rem)] leading-[0.99] font-bold">
              <span className="block">{t('headline_line_1')}</span>
              <span className="text-primary-ink block">{t('headline_line_2')}</span>
            </h1>
            <p className="text-muted-foreground mt-6 max-w-lg text-base leading-7 sm:mt-7 sm:text-lg sm:leading-8">
              {t('sub')}
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              {session.isPending ? (
                <Button size="lg" disabled className="w-full sm:w-auto">
                  {commonT('loading')}
                </Button>
              ) : (
                <Button asChild size="lg" className="w-full sm:w-auto">
                  <Link href="/login?next=%2Fgroups">
                    {t('cta_signed_out')}
                    <ArrowRight data-icon="inline-end" aria-hidden="true" />
                  </Link>
                </Button>
              )}
              <Button asChild size="lg" variant="outline" className="w-full sm:w-auto">
                <a href="#how">{t('learn_more')}</a>
              </Button>
            </div>
          </div>

          <LedgerPreview />
        </div>
      </section>

      <section id="how" className="border-border bg-card border-y">
        <div className="mx-auto w-full max-w-7xl px-5 py-14 sm:px-8 sm:py-16 lg:px-10">
          <p className="text-muted-foreground mb-9 text-sm font-semibold">{t('learn_more')}</p>
          <div className="before:border-border relative grid gap-8 before:absolute before:top-5 before:bottom-5 before:left-5 before:border-l md:grid-cols-3 md:gap-0 md:before:inset-x-5 md:before:bottom-auto md:before:border-t md:before:border-l-0">
            <FeatureStep
              number="01"
              title={t('feature_capture_title')}
              description={t('feature_capture_desc')}
            />
            <FeatureStep
              number="02"
              title={t('feature_collab_title')}
              description={t('feature_collab_desc')}
            />
            <FeatureStep
              number="03"
              title={t('feature_balance_title')}
              description={t('feature_balance_desc')}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
