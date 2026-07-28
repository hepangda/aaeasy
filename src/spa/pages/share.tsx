import { useParams } from 'react-router';
import { useTranslations } from 'use-intl';
import { Link2 } from 'lucide-react';
import { ShareUnlockForm } from '@/components/share/share-unlock-form';

export function SharePage() {
  const token = useParams<{ token: string }>().token ?? '';
  const t = useTranslations();

  return (
    <section className="bg-background text-foreground flex w-full flex-1 items-center px-4 py-10 sm:px-6 sm:py-16">
      <div className="bg-card mx-auto flex w-full max-w-md flex-col items-center rounded-xl border p-6 text-center sm:p-9">
        <span className="border-primary/15 bg-secondary text-secondary-foreground grid size-11 place-items-center rounded-lg border">
          <Link2 className="size-5" aria-hidden="true" />
        </span>
        <h1 className="font-display mt-5 text-2xl font-bold tracking-[-0.04em] sm:text-3xl">
          {t('share.title')}
        </h1>
        <div className="bg-border my-6 h-px w-full" aria-hidden />
        <ShareUnlockForm token={token} />
      </div>
    </section>
  );
}
