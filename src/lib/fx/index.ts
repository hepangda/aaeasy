/**
 * Foreign-exchange rate lookup.
 *
 * Source: <https://www.frankfurter.app> — free ECB-published reference rates,
 * no API key. Each (base, quote, date) tuple is cached forever in
 * `fx_rate_cache` once fetched (historical ECB rates don't move).
 *
 * Lookup order:
 *   1. Cache hit → return immediately.
 *   2. Network → on success, persist + return.
 *   3. Network failure → return `null` so the caller can either prompt the
 *      user for a manual override or fail safely.
 *
 * Identity (base === quote) returns 1 without touching the cache.
 *
 * The `fetcher` argument is injectable for tests; in production it defaults
 * to `globalThis.fetch`.
 */

import Decimal from 'decimal.js';
import { prisma } from '@/lib/db';

const FRANKFURTER_BASE = 'https://api.frankfurter.app';

type Fetcher = typeof fetch;

export interface FetchRateOpts {
  base: string;
  quote: string;
  /** A date for which the rate is requested (UTC; only the date portion matters). */
  date: Date;
  fetcher?: Fetcher;
  /** Skip cache write/read (used in tests). */
  noCache?: boolean;
}

export async function getFxRate(opts: FetchRateOpts): Promise<Decimal | null> {
  const base = opts.base.toUpperCase();
  const quote = opts.quote.toUpperCase();
  if (base === quote) return new Decimal(1);

  const dateOnly = startOfUtcDay(opts.date);

  if (!opts.noCache) {
    const cached = await prisma.fxRateCache.findUnique({
      where: { base_quote_date: { base, quote, date: dateOnly } },
    });
    if (cached) return new Decimal(cached.rate.toString());
  }

  const fetcher = opts.fetcher ?? fetch;

  let rate: Decimal | null = null;
  try {
    rate = await fetchFromFrankfurter(fetcher, base, quote, dateOnly);
  } catch {
    return null;
  }

  if (rate && !opts.noCache) {
    await prisma.fxRateCache
      .upsert({
        where: { base_quote_date: { base, quote, date: dateOnly } },
        create: { base, quote, date: dateOnly, rate: rate.toString() },
        update: {}, // never overwrite — first writer wins
      })
      .catch(() => {});
  }

  return rate;
}

/**
 * Pure variant: just calls the upstream API. Useful for tests or for batching
 * by the caller (don't use in hot paths — prefer `getFxRate` so the cache
 * absorbs traffic).
 */
export async function fetchFromFrankfurter(
  fetcher: Fetcher,
  base: string,
  quote: string,
  date: Date,
): Promise<Decimal | null> {
  if (base === quote) return new Decimal(1);
  // The historical endpoint accepts /YYYY-MM-DD?from=BASE&to=QUOTE
  const dateStr = formatYmd(date);
  const url = `${FRANKFURTER_BASE}/${dateStr}?from=${encodeURIComponent(base)}&to=${encodeURIComponent(quote)}`;

  const res = await fetcher(url, {
    headers: { accept: 'application/json' },
    // 5s budget per request — caller is in a Server Action, mustn't hang.
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) return null;

  const json = (await res.json()) as { rates?: Record<string, number> };
  const v = json.rates?.[quote];
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return null;
  return new Decimal(v);
}

export function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function formatYmd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
