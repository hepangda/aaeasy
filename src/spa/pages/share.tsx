import { useParams } from 'react-router';
import { useTranslations } from 'use-intl';
import { Link2 } from 'lucide-react';
import { ShareUnlockForm } from '@/components/share/share-unlock-form';
import { Card } from '@/components/ui/card';

export function SharePage() {
  const token = useParams<{ token: string }>().token ?? '';
  const t = useTranslations();

  return (
    <section className="bg-background text-foreground flex w-full flex-1 items-center px-4 py-10 sm:px-6 sm:py-16">
      <Card
        padding="body"
        className="mx-auto flex w-full max-w-md flex-col items-center text-center sm:p-9"
      >
        <span className="border-primary/15 bg-secondary text-secondary-foreground grid size-11 place-items-center rounded-lg border">
          <Link2 className="size-5" aria-hidden="true" />
        </span>
        <h1 className="font-display tracking-display mt-5 text-3xl font-bold sm:text-4xl">
          {t('share.title')}
        </h1>
        <div className="border-border my-6 w-full border-t" aria-hidden="true" />
        <ShareUnlockForm token={token} />
      </Card>
    </section>
  );
}
