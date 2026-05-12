'use client';

/**
 * Thin wrapper around `sonner` so all error notifications share the same
 * styling and i18n behavior. Components should call `errorToast(key)`
 * with an i18n key (preferred) or a plain message string.
 */
import { toast } from 'sonner';
import type { useTranslations } from 'next-intl';

type Translator = ReturnType<typeof useTranslations>;

export function errorToast(message: string): void {
  toast.error(message);
}

/**
 * Convenience: translate an i18n error key and show it as an error toast.
 *
 * Only attempts translation for strings that look like dotted i18n keys
 * (e.g. `errors.invalid_amount`). Anything else is shown verbatim — this
 * avoids next-intl's MISSING_MESSAGE warning when an upstream layer
 * leaks a raw library message such as a zod validation string.
 */
export function showI18nError(t: Translator, key: string): void {
  const looksLikeKey = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/i.test(key);
  let msg = key;
  if (looksLikeKey) {
    try {
      msg = (t as unknown as (k: string) => string)(key) || key;
    } catch {
      msg = key;
    }
  }
  toast.error(msg);
}

export function successToast(message: string): void {
  toast.success(message);
}

export { toast };
