import { z } from 'zod';

/**
 * Common choices shown by the UI. The API still accepts any well-formed
 * ISO-4217-style code so existing or less common currencies remain editable.
 */
export const COMMON_CURRENCIES = [
  'CNY',
  'USD',
  'EUR',
  'JPY',
  'GBP',
  'HKD',
  'SGD',
  'AUD',
  'CAD',
  'CHF',
  'KRW',
  'THB',
] as const;

export const currencyCodeSchema = z
  .string()
  .trim()
  .length(3)
  .transform((value) => value.toUpperCase())
  .refine((value) => /^[A-Z]{3}$/u.test(value), 'Invalid currency code');
