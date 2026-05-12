'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { isLocale, LOCALE_COOKIE, type Locale } from '@/i18n/config';

export async function setLocaleAction(next: string) {
  if (!isLocale(next)) return;
  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE, next satisfies Locale, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  });
  revalidatePath('/', 'layout');
}
