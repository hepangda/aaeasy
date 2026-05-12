import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { getCurrentSession } from '@/lib/auth/session';

export default async function Home() {
  const t = await getTranslations('home');
  const ctx = await getCurrentSession();
  const cta = ctx ? '/groups' : '/login';
  return (
    <section className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-8 px-6 py-20 text-center">
      <h1 className="text-foreground text-4xl leading-tight font-semibold tracking-tight sm:text-5xl">
        {t('headline')}
      </h1>
      <p className="text-muted-foreground max-w-xl text-base leading-relaxed sm:text-lg">
        {t('sub')}
      </p>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button asChild size="lg">
          <Link href={cta}>{t('get_started')}</Link>
        </Button>
      </div>
    </section>
  );
}
