import { useParams } from 'react-router';
import { useTranslations } from 'use-intl';
import { Link2 } from 'lucide-react';
import { ShareUnlockForm } from '@/components/share/share-unlock-form';

export function SharePage() {
  const token = useParams<{ token: string }>().token ?? '';
  const t = useTranslations();

  return (
    <section className="bg-background text-foreground flex w-full flex-1 items-center px-4 py-10 sm:px-6 sm:py-16">
      <div className="bg-card shadow-soft mx-auto flex w-full max-w-md flex-col items-center rounded-2xl border p-6 text-center sm:p-10">
        <span className="bg-secondary text-secondary-foreground grid size-12 place-items-center rounded-xl">
          <Link2 className="size-5" aria-hidden="true" />
        </span>
        <h1 className="mt-5 text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">
          {t('share.title')}
        </h1>
        <div className="bg-border my-6 h-px w-full" aria-hidden />
        <ShareUnlockForm token={token} />
      </div>
    </section>
  );
}
