import Link from '@/compat/link';
import { ArrowRight, Check, ReceiptText, Scale, UsersRound, type LucideIcon } from 'lucide-react';
import { Navigate } from 'react-router';
import { useTranslations } from 'use-intl';
import { Button } from '@/components/ui/button';
import { useSessionQuery } from '../queries';

function FlowConnector({ tone }: { tone: 'signal' | 'positive' }) {
  return (
    <div className="flex h-9 items-center justify-center md:h-auto" aria-hidden="true">
      <span
        className={`h-7 w-px md:hidden ${tone === 'signal' ? 'bg-signal/70' : 'bg-positive/70'}`}
      />
      <svg
        viewBox="0 0 48 18"
        className={`hidden w-full overflow-visible md:block ${tone === 'signal' ? 'text-signal' : 'text-positive'}`}
      >
        <path
          d="M2 9h41"
          className="flow-path"
          fill="none"
          stroke="currentColor"
          strokeLinecap="square"
          strokeWidth="1.5"
        />
        <path d="m40 5 4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </div>
  );
}

function StageLabel({
  children,
  complete = false,
}: {
  children: React.ReactNode;
  complete?: boolean;
}) {
  return (
    <div className="mb-4 flex items-center gap-2 font-mono text-[10px] font-semibold tracking-[0.12em] text-white/48 uppercase">
      <span
        className={`grid size-5 place-items-center rounded border ${
          complete ? 'border-positive/70 bg-positive/15 text-positive' : 'border-white/20'
        }`}
      >
        {complete ? (
          <Check className="size-3" strokeWidth={2.5} aria-hidden="true" />
        ) : (
          <span className="size-1 bg-current" />
        )}
      </span>
      {children}
    </div>
  );
}

function ProductSignal() {
  const t = useTranslations('home');

  return (
    <div
      aria-label={t('demo_balance')}
      className="bg-ledger text-ledger-foreground shadow-lifted interface-enter-delayed relative isolate overflow-hidden rounded-xl border border-white/10 p-4 sm:p-6 lg:p-7"
    >
      <div className="relative mb-5 flex items-center justify-between gap-3 border-b border-white/10 pb-4">
        <p className="text-sm font-semibold tracking-[-0.02em] text-white sm:text-base">
          {t('demo_group')}
        </p>
        <div className="flex -space-x-2" aria-hidden="true">
          {['L', 'Y', 'Z'].map((initial, index) => (
            <span
              key={initial}
              className={`border-ledger grid size-7 place-items-center rounded-full border-2 font-mono text-[9px] font-bold text-white ${
                index === 0 ? 'bg-signal/90' : index === 1 ? 'bg-positive/80' : 'bg-primary'
              }`}
            >
              {initial}
            </span>
          ))}
        </div>
      </div>

      <div className="relative grid items-stretch md:grid-cols-[minmax(0,1.05fr)_2.5rem_minmax(0,0.9fr)_2.5rem_minmax(0,1.05fr)]">
        <section className="rounded-lg border border-white/10 bg-white/4 p-4">
          <StageLabel complete>{t('feature_capture_title')}</StageLabel>
          <div className="flex items-start gap-3">
            <span className="bg-primary/25 text-primary-foreground grid size-9 shrink-0 place-items-center rounded-md border border-white/8">
              <ReceiptText className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-white">{t('demo_expense')}</p>
              <p className="mt-1 text-xs leading-relaxed text-white/50">{t('demo_payer')}</p>
            </div>
            <span className="font-mono text-sm font-bold whitespace-nowrap text-white">¥438</span>
          </div>
        </section>

        <FlowConnector tone="signal" />

        <section className="rounded-lg border border-white/10 bg-white/4 p-4">
          <StageLabel complete>{t('feature_balance_title')}</StageLabel>
          <dl className="grid gap-2.5 text-xs">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-white/65">Zehao</dt>
              <dd className="text-positive font-mono font-bold">+¥222</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-white/65">Lin</dt>
              <dd className="text-signal font-mono font-bold">−¥168</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-white/65">Yuki</dt>
              <dd className="text-signal font-mono font-bold">−¥54</dd>
            </div>
          </dl>
        </section>

        <FlowConnector tone="positive" />

        <section className="rounded-lg border border-white/10 bg-white/4 p-4">
          <StageLabel>{t('demo_balance')}</StageLabel>
          <div className="grid">
            <div className="flex items-center justify-between gap-2 border-b border-white/10 py-2.5">
              <span className="text-xs font-semibold text-white">Lin → Zehao</span>
              <span className="text-signal font-mono text-[11px] font-bold">¥168</span>
            </div>
            <div className="flex items-center justify-between gap-2 py-2.5">
              <span className="text-xs font-semibold text-white">Yuki → Zehao</span>
              <span className="text-positive font-mono text-[11px] font-bold">¥54</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function Feature({
  number,
  title,
  description,
  Icon,
}: {
  number: string;
  title: string;
  description: string;
  Icon: LucideIcon;
}) {
  return (
    <article className="border-border group relative border-t pt-6 md:border-t-0 md:border-l md:pt-0 md:pl-8 md:first:border-l-0 md:first:pl-0">
      <div className="mb-6 flex items-center justify-between gap-4">
        <span className="text-primary-ink font-mono text-[11px] font-bold tracking-[0.12em]">
          {number}
        </span>
        <span className="border-primary/15 bg-secondary text-secondary-foreground group-hover:border-primary/30 group-hover:bg-accent grid size-9 place-items-center rounded-lg border transition-colors duration-200">
          <Icon className="size-4" aria-hidden="true" />
        </span>
      </div>
      <h2 className="font-display text-foreground text-lg font-semibold tracking-[-0.035em] sm:text-xl">
        {title}
      </h2>
      <p className="text-muted-foreground mt-2 max-w-sm text-sm leading-6">{description}</p>
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
      <section className="mx-auto grid min-h-[calc(100svh-3.5rem)] w-full max-w-7xl items-center gap-12 px-5 py-14 sm:px-8 sm:py-18 lg:grid-cols-[0.88fr_1.12fr] lg:gap-16 lg:px-10 lg:py-20">
        <div className="interface-enter max-w-2xl">
          <h1 className="font-display text-foreground max-w-[11ch] text-[clamp(3rem,6.4vw,5.25rem)] leading-[0.98] font-bold tracking-[-0.068em]">
            {t('headline_line_1')} — {t('headline_line_2')}
          </h1>
          <p className="text-muted-foreground mt-6 max-w-xl text-base leading-7 sm:text-lg sm:leading-8">
            {t('sub')}
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            {session.isPending ? (
              <Button size="lg" disabled>
                {commonT('loading')}
              </Button>
            ) : (
              <Button asChild size="lg">
                <Link href="/login?next=%2Fgroups">
                  {t('cta_signed_out')}
                  <ArrowRight data-icon="inline-end" aria-hidden="true" />
                </Link>
              </Button>
            )}
            <Button asChild size="lg" variant="outline">
              <a href="#how">{t('learn_more')}</a>
            </Button>
          </div>
        </div>

        <ProductSignal />
      </section>

      <section
        id="how"
        className="border-border bg-card border-y px-5 py-14 sm:px-8 sm:py-16 lg:px-10"
      >
        <div className="mx-auto grid w-full max-w-7xl gap-10 md:grid-cols-3 md:gap-8 lg:gap-14">
          <Feature
            number="01"
            title={t('feature_capture_title')}
            description={t('feature_capture_desc')}
            Icon={ReceiptText}
          />
          <Feature
            number="02"
            title={t('feature_collab_title')}
            description={t('feature_collab_desc')}
            Icon={UsersRound}
          />
          <Feature
            number="03"
            title={t('feature_balance_title')}
            description={t('feature_balance_desc')}
            Icon={Scale}
          />
        </div>
      </section>
    </div>
  );
}
