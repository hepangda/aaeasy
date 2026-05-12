import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getCurrentSession } from '@/lib/auth/session';
import { NewGroupForm } from '@/components/new-group-form';

export default async function NewGroupPage() {
  if (!(await getCurrentSession())) redirect('/login?next=/groups/new');
  const t = await getTranslations('groups');
  return (
    <section className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">{t('new_group')}</h1>
      <NewGroupForm />
    </section>
  );
}
