import { cookies, headers } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { defaultLocale, isLocale, LOCALE_COOKIE, type Locale } from './config';

async function detectLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const fromCookie = cookieStore.get(LOCALE_COOKIE)?.value;
  if (isLocale(fromCookie)) return fromCookie;

  const hdrs = await headers();
  const accept = hdrs.get('accept-language') ?? '';
  const first = accept.split(',')[0]?.trim().toLowerCase() ?? '';
  if (first.startsWith('zh')) return 'zh';
  if (first.startsWith('en')) return 'en';
  return defaultLocale;
}

export default getRequestConfig(async () => {
  const locale = await detectLocale();
  const messages = (await import(`../../messages/${locale}.json`)).default;
  return {
    locale,
    messages,
    // Named formats reused across the app so call-sites can stay terse:
    //   fmt.dateTime(d, 'short') / 'long'
    formats: {
      dateTime: {
        short: { year: 'numeric', month: '2-digit', day: '2-digit' },
        long: {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        },
      },
    },
  };
});
