import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { RegisterForm } from '@/components/register-form';
import { getCurrentSession } from '@/lib/auth/session';

export default async function RegisterPage() {
  if (await getCurrentSession()) redirect('/');
  const t = await getTranslations('auth');
  return (
    <section className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-8 px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">{t('register_title')}</h1>
      <RegisterForm />
    </section>
  );
}
