import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { IntlProvider } from 'use-intl';
import en from '../../messages/en.json';
import zh from '../../messages/zh.json';

export type Locale = 'zh' | 'en';

const MESSAGES = { zh, en } as const;
const STORAGE_KEY = 'aaeasy_locale';

function isLocale(value: unknown): value is Locale {
  return value === 'zh' || value === 'en';
}

export function initialLocale(): Locale {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (isLocale(stored)) return stored;
  const cookie = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${STORAGE_KEY}=`))
    ?.split('=')[1];
  if (isLocale(cookie)) return cookie;
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

function applyDocumentLocale(locale: Locale): void {
  document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
  document.title = `${MESSAGES[locale].app.name} · ${MESSAGES[locale].app.tagline}`;
}

const FORMATS = {
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
} as const;

const SetLocaleContext = createContext<(locale: Locale) => void>(() => {});

/** Switch the app's language. */
export function useSetLocale() {
  return useContext(SetLocaleContext);
}

/**
 * Locale state and the `use-intl` provider around it.
 *
 * Both message bundles are already in the JS bundle, so switching languages is
 * a state update. It used to call `location.reload()`, which threw away the
 * query cache and the user's place in the app to change a string table.
 */
export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(() => {
    const initial = initialLocale();
    applyDocumentLocale(initial);
    return initial;
  });

  const changeLocale = useCallback((next: Locale) => {
    window.localStorage.setItem(STORAGE_KEY, next);
    // The cookie is what the Worker reads when rendering PDFs and exports.
    document.cookie = `${STORAGE_KEY}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
    applyDocumentLocale(next);
    setLocale(next);
  }, []);

  return (
    <SetLocaleContext.Provider value={changeLocale}>
      <IntlProvider
        locale={locale}
        messages={MESSAGES[locale]}
        timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone}
        formats={FORMATS}
      >
        {children}
      </IntlProvider>
    </SetLocaleContext.Provider>
  );
}
