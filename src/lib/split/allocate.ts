import Decimal from 'decimal.js';
import { parseAmountToMinor } from '@aaeasy/core/money';

/**
 * Pure money helpers for the split editor. Extracted from `expense-form.tsx`
 * so they can be unit tested without mounting a 1600-line component.
 */

/** Parse a positive major-unit amount. Empty is 0; unparseable is null. */
export function parseMajorMinor(text: string, currency: string): bigint | null {
  const t = text.trim();
  if (!t) return 0n;
  try {
    return parseAmountToMinor(t, currency);
  } catch {
    return null;
  }
}

/**
 * Same as `parseMajorMinor` but accepts a leading minus so the extras column
 * can record refunds / discounts as negative amounts. Both the ASCII hyphen
 * and the typographic minus (U+2212) that `formatMoney` emits are accepted.
 */
export function parseSignedMajorMinor(text: string, currency: string): bigint | null {
  const t = text.trim().replace(/^−/, '-');
  if (!t) return 0n;
  const negative = t.startsWith('-');
  const body = negative ? t.slice(1).trim() : t;
  if (!body) return null;
  try {
    const v = parseAmountToMinor(body, currency);
    return negative ? -v : v;
  } catch {
    return null;
  }
}

/**
 * Distribute `total` minor units across `weights` using the largest-remainder
 * method. Returns one minor-unit bigint per input weight (parallel array);
 * zero-weight inputs get 0.
 *
 * The remainder goes to the largest fractional parts first, with ties broken
 * by index so the result is deterministic across renders.
 */
export function distribute(total: bigint, weights: number[]): bigint[] {
  if (total <= 0n) return weights.map(() => 0n);
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0) return weights.map(() => 0n);

  const totalD = new Decimal(total.toString());
  const sumD = new Decimal(sum);
  const rows = weights.map((w, i) => {
    const exact = totalD.times(w).div(sumD);
    const floor = exact.toDecimalPlaces(0, Decimal.ROUND_FLOOR);
    return { i, base: BigInt(floor.toFixed(0)), frac: exact.minus(floor) };
  });

  let remainder = total - rows.reduce((a, r) => a + r.base, 0n);
  const ranked = rows.slice().sort((a, b) => b.frac.cmp(a.frac) || a.i - b.i);
  let k = 0;
  while (remainder > 0n) {
    rows[ranked[k % ranked.length]!.i]!.base += 1n;
    remainder--;
    k++;
  }
  return rows.map((r) => r.base);
}
