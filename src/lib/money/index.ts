/**
 * Money helpers.
 *
 * Internal representation: integer "minor units" of a given currency
 * (e.g. cents for USD, fen for CNY). We use `bigint` so totals and shares
 * never lose precision. Currency is always carried alongside as a 3-letter
 * ISO 4217 code; this module does NOT do conversion (see `lib/fx`).
 *
 * Arithmetic that needs fractional intermediates (e.g. weighted splits, FX
 * conversion) goes through `Decimal` and ends with a single rounding step
 * back to bigint.
 *
 * Display / parsing rules:
 *   - We assume 2 minor digits for almost every common currency. The few
 *     0-digit (JPY, KRW) and 3-digit (KWD) currencies are handled via an
 *     explicit override map below.
 *   - Parsing is locale-friendly: it strips `, _ ` separators and accepts
 *     either `.` or `,` as the decimal mark provided there's exactly one of
 *     them. Anything else throws.
 */

import Decimal from 'decimal.js';

// Currencies whose minor unit ≠ 2 decimal digits. Default is 2.
const NON_TWO_DIGIT: Readonly<Record<string, number>> = {
  JPY: 0,
  KRW: 0,
  VND: 0,
  IDR: 0,
  ISK: 0,
  CLP: 0,
  XAF: 0,
  XOF: 0,
  XPF: 0,
  RWF: 0,
  KMF: 0,
  GNF: 0,
  PYG: 0,
  UGX: 0,
  KWD: 3,
  BHD: 3,
  IQD: 3,
  JOD: 3,
  LYD: 3,
  OMR: 3,
  TND: 3,
};

/** Decimal places used by a given currency's minor unit. */
export function minorUnits(currency: string): number {
  return NON_TWO_DIGIT[currency.toUpperCase()] ?? 2;
}

const TEN = new Decimal(10);

function scaleFor(currency: string): Decimal {
  return TEN.pow(minorUnits(currency));
}

/**
 * Parse a human-entered amount (e.g. "1,234.56") into integer minor units.
 * Throws on invalid / negative / non-finite input.
 */
export function parseAmountToMinor(input: string, currency: string): bigint {
  if (typeof input !== 'string') throw new Error('AMOUNT_NOT_STRING');
  let s = input.trim();
  if (!s) throw new Error('AMOUNT_EMPTY');

  // Strip thousands separators / spaces / underscores while leaving exactly
  // one decimal mark (either '.' or ',').
  const dots = (s.match(/\./g) ?? []).length;
  const commas = (s.match(/,/g) ?? []).length;

  if (dots > 0 && commas > 0) {
    // Treat the rightmost as the decimal mark, the other as thousands sep.
    const lastDot = s.lastIndexOf('.');
    const lastComma = s.lastIndexOf(',');
    if (lastDot > lastComma) {
      s = s.replace(/,/g, '');
    } else {
      s = s.replace(/\./g, '').replace(',', '.');
    }
  } else if (commas === 1 && dots === 0) {
    // Single comma → decimal mark in many locales (1,5).
    s = s.replace(',', '.');
  } else if (commas > 1) {
    // 1,234,567 — pure thousands separators
    s = s.replace(/,/g, '');
  }

  s = s.replace(/[\s_]/g, '');

  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error('AMOUNT_INVALID');

  const d = new Decimal(s);
  if (!d.isFinite()) throw new Error('AMOUNT_INVALID');
  if (d.isNegative()) throw new Error('AMOUNT_NEGATIVE');

  return decimalToMinor(d, currency);
}

/** Round (HALF_EVEN) a Decimal expressed in MAJOR units to integer minor units. */
export function decimalToMinor(value: Decimal | string | number, currency: string): bigint {
  const d = value instanceof Decimal ? value : new Decimal(value);
  const scaled = d.times(scaleFor(currency)).toDecimalPlaces(0, Decimal.ROUND_HALF_EVEN);
  return BigInt(scaled.toFixed(0));
}

/** Convert minor-unit bigint back to a Decimal in MAJOR units (lossless). */
export function minorToDecimal(minor: bigint, currency: string): Decimal {
  return new Decimal(minor.toString()).div(scaleFor(currency));
}

/**
 * Format minor units for display, e.g. `formatMinor(123456n, 'CNY')` →
 * `"1234.56"`. No thousands separator and no symbol — the UI layer chooses
 * Intl formatting based on locale.
 */
export function formatMinor(minor: bigint, currency: string): string {
  const places = minorUnits(currency);
  if (places === 0) return minor.toString();
  const neg = minor < 0n;
  const abs = neg ? -minor : minor;
  const s = abs.toString().padStart(places + 1, '0');
  const head = s.slice(0, -places);
  const tail = s.slice(-places);
  return `${neg ? '-' : ''}${head}.${tail}`;
}

/**
 * Format `minor` units with its 3-letter currency code as a prefix
 * (e.g. `formatMoney(12345n, 'CNY')` → `"CNY 123.45"`). We deliberately
 * *don't* use locale-specific symbols (¥, $, €, …) because they collide
 * across currencies (CNY ¥ vs JPY ¥, CAD $ vs USD $, etc.), making
 * multi-currency expense lists ambiguous. Numbers themselves are still
 * locale-formatted (thousand separators, decimal mark).
 *
 * Falls back to a manual format on a malformed/unknown currency code.
 */
export function formatMoney(
  minor: bigint,
  currency: string,
  locale: string = 'en-US',
): string {
  try {
    const n = Number(minorToDecimal(minor, currency).toFixed(minorUnits(currency)));
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      currencyDisplay: 'code',
    }).format(n);
  } catch {
    return `${currency} ${formatMinor(minor, currency)}`;
  }
}

/**
 * Convert a minor-unit amount in one currency to another, via a Decimal rate
 * `quote = base * rate`. Always rounds to the destination's minor unit.
 */
export function convertMinor(
  minor: bigint,
  fromCurrency: string,
  toCurrency: string,
  rate: Decimal | string | number,
): bigint {
  if (fromCurrency === toCurrency) return minor;
  const r = rate instanceof Decimal ? rate : new Decimal(rate);
  const major = minorToDecimal(minor, fromCurrency).times(r);
  return decimalToMinor(major, toCurrency);
}

/** Sum a list of bigints — convenience to avoid `.reduce(BigInt(0))` noise. */
export function sumBig(xs: Iterable<bigint>): bigint {
  let total = 0n;
  for (const x of xs) total += x;
  return total;
}

/** ISO 4217 currency-code shape check (3 uppercase letters). */
export function isCurrencyCode(s: string): boolean {
  return /^[A-Z]{3}$/.test(s);
}
