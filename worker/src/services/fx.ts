import type { Database } from '@aaeasy/db';
import { fxRateCache } from '@aaeasy/db/schema';
import Decimal from 'decimal.js';
import { and, eq } from 'drizzle-orm';

function formatDate(date: Date): string {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

export async function getFxRate(
  db: Database,
  input: { base: string; quote: string; date: Date },
): Promise<Decimal | null> {
  const base = input.base.toUpperCase();
  const quote = input.quote.toUpperCase();
  if (base === quote) return new Decimal(1);
  const date = formatDate(input.date);

  const [cached] = await db
    .select({ rate: fxRateCache.rate })
    .from(fxRateCache)
    .where(
      and(eq(fxRateCache.base, base), eq(fxRateCache.quote, quote), eq(fxRateCache.date, date)),
    )
    .limit(1);
  if (cached) return new Decimal(cached.rate);

  let rate: Decimal;
  try {
    const response = await fetch(
      `https://api.frankfurter.app/${date}?from=${encodeURIComponent(base)}&to=${encodeURIComponent(quote)}`,
      { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(5_000) },
    );
    if (!response.ok) return null;
    const payload = (await response.json()) as { rates?: Record<string, number> };
    const value = payload.rates?.[quote];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
    rate = new Decimal(value);
  } catch {
    return null;
  }

  // The rate is already usable; a failed cache write must not degrade into
  // "FX unavailable" for the caller.
  await db
    .insert(fxRateCache)
    .values({ base, quote, date, rate: rate.toString() })
    .onConflictDoNothing();
  return rate;
}
