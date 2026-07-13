import Link from '@/compat/link';
import { useTranslations } from 'use-intl';
import { Button } from '@/components/ui/button';
import { useSessionQuery } from '../queries';

export function HomePage() {
  const t = useTranslations('home');
  const session = useSessionQuery();
  const cta = session.data?.user ? '/groups' : '/login';
  return (
    <section className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-8 px-6 py-20 text-center">
      <h1 className="text-foreground text-4xl leading-tight font-semibold tracking-tight sm:text-5xl">
        {t('headline')}
      </h1>
      <p className="text-muted-foreground max-w-xl text-base leading-relaxed sm:text-lg">
        {t('sub')}
      </p>
      <Button asChild size="lg">
        <Link href={cta}>{t('get_started')}</Link>
      </Button>
    </section>
  );
}
