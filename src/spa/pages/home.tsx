import Link from '@/compat/link';
import { ArrowRight, Check, ReceiptText, Scale, UsersRound, type LucideIcon } from 'lucide-react';
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
          d="M2 9c12-7 29 7 41 0"
          className="flow-path"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="2"
        />
        <path d="m39 5 5 4-5 4" fill="none" stroke="currentColor" strokeWidth="2" />
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
    <div className="mb-4 flex items-center gap-2 text-[11px] font-bold tracking-[0.13em] text-white/55 uppercase">
      <span
        className={`grid size-5 place-items-center rounded-full border ${
          complete ? 'border-positive/70 bg-positive/15 text-positive' : 'border-white/20'
        }`}
      >
        {complete ? (
          <Check className="size-3" aria-hidden="true" />
        ) : (
          <span className="size-1 rounded-full bg-current" />
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
      className="bg-ledger text-ledger-foreground shadow-lifted relative isolate overflow-hidden rounded-[1.75rem] p-4 sm:p-6 lg:p-7"
    >
      <div className="bg-signal/8 pointer-events-none absolute -top-20 -left-14 size-72 rounded-full border border-white/5" />
      <div className="bg-positive/8 pointer-events-none absolute -right-24 -bottom-28 size-72 rounded-full border border-white/5" />

      <div className="relative mb-6 flex items-center justify-between gap-3">
        <p className="font-display text-sm font-bold tracking-[-0.02em] text-white sm:text-base">
          {t('demo_group')}
        </p>
        <div className="flex -space-x-2" aria-hidden="true">
          {['L', 'Y', 'Z'].map((initial, index) => (
            <span
              key={initial}
              className={`border-ledger grid size-7 place-items-center rounded-full border-2 text-[10px] font-bold text-white ${
                index === 0 ? 'bg-signal/90' : index === 1 ? 'bg-positive/80' : 'bg-primary'
              }`}
            >
              {initial}
            </span>
          ))}
        </div>
      </div>

      <div className="relative grid items-stretch md:grid-cols-[minmax(0,1.05fr)_2.5rem_minmax(0,0.9fr)_2.5rem_minmax(0,1.05fr)]">
        <section className="rounded-2xl border border-white/10 bg-white/7 p-4">
          <StageLabel complete>{t('feature_capture_title')}</StageLabel>
          <div className="flex items-start gap-3">
            <span className="bg-primary/25 text-primary-foreground grid size-10 shrink-0 place-items-center rounded-xl">
              <ReceiptText className="size-5" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-white">{t('demo_expense')}</p>
              <p className="mt-1 text-xs leading-relaxed text-white/50">{t('demo_payer')}</p>
            </div>
            <span className="font-mono text-sm font-bold whitespace-nowrap text-white">¥438</span>
          </div>
        </section>

        <FlowConnector tone="signal" />

        <section className="rounded-2xl border border-white/10 bg-white/7 p-4">
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

        <section className="rounded-2xl border border-white/10 bg-white/7 p-4">
          <StageLabel>{t('demo_balance')}</StageLabel>
          <div className="grid gap-2">
            <div className="border-signal/25 bg-signal/10 flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5">
              <span className="text-xs font-semibold text-white">Lin → Zehao</span>
              <span className="bg-signal text-signal-foreground rounded-full px-2 py-1 font-mono text-[11px] font-bold">
                ¥168
              </span>
            </div>
            <div className="border-positive/25 bg-positive/10 flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5">
              <span className="text-xs font-semibold text-white">Yuki → Zehao</span>
              <span className="bg-positive text-positive-foreground rounded-full px-2 py-1 font-mono text-[11px] font-bold">
                ¥54
              </span>
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
    <article className="border-border/75 group relative border-t pt-5">
      <div className="mb-8 flex items-center justify-between gap-4">
        <span className="text-primary-ink font-mono text-xs font-bold">{number}</span>
        <span className="bg-secondary text-secondary-foreground grid size-10 place-items-center rounded-xl transition-transform duration-300 motion-safe:group-hover:scale-105 motion-safe:group-hover:-rotate-3">
          <Icon className="size-4.5" aria-hidden="true" />
        </span>
      </div>
      <h2 className="font-display text-foreground text-xl font-bold tracking-[-0.035em]">
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
  const signedIn = Boolean(session.data?.user);
  const cta = signedIn ? '/groups' : '/login?next=%2Fgroups';

  return (
    <div className="relative isolate flex flex-1 flex-col overflow-hidden">
      <div className="bg-primary/6 pointer-events-none absolute top-16 right-[-12rem] -z-10 size-[34rem] rounded-full blur-3xl" />
      <div className="bg-signal/8 pointer-events-none absolute top-[32rem] left-[-14rem] -z-10 size-[30rem] rounded-full blur-3xl" />

      <section className="mx-auto grid w-full max-w-7xl items-center gap-12 px-5 py-12 sm:px-8 sm:py-18 lg:grid-cols-[0.82fr_1.18fr] lg:gap-16 lg:px-10 lg:py-24">
        <div className="max-w-2xl">
          <h1 className="font-display text-foreground text-[clamp(2.75rem,6vw,4.75rem)] leading-[0.96] font-black tracking-[-0.065em]">
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
                <Link href={cta}>
                  {signedIn ? t('cta_signed_in') : t('cta_signed_out')}
                  <ArrowRight aria-hidden="true" />
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
        className="border-border/70 bg-card/55 border-y px-5 py-14 sm:px-8 sm:py-18 lg:px-10"
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
