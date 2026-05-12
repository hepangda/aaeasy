import { describe, expect, it, vi } from 'vitest';
import Decimal from 'decimal.js';
import { fetchFromFrankfurter, startOfUtcDay } from './index';

function mockFetch(payload: unknown, ok = true): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify(payload), { status: ok ? 200 : 500 }),
  ) as unknown as typeof fetch;
}

describe('startOfUtcDay', () => {
  it('strips time portion', () => {
    const d = new Date('2025-06-15T10:42:33.123Z');
    const r = startOfUtcDay(d);
    expect(r.toISOString()).toBe('2025-06-15T00:00:00.000Z');
  });
});

describe('fetchFromFrankfurter', () => {
  it('returns 1 when base === quote without calling fetch', async () => {
    const f = vi.fn();
    const r = await fetchFromFrankfurter(f as unknown as typeof fetch, 'USD', 'USD', new Date());
    expect(r?.eq(1)).toBe(true);
    expect(f).not.toHaveBeenCalled();
  });

  it('returns the rate for the requested quote', async () => {
    const fetcher = mockFetch({ amount: 1, base: 'USD', date: '2025-06-15', rates: { CNY: 7.2345 } });
    const r = await fetchFromFrankfurter(fetcher, 'USD', 'CNY', new Date('2025-06-15'));
    expect(r?.eq(new Decimal('7.2345'))).toBe(true);
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.frankfurter.app/2025-06-15?from=USD&to=CNY',
      expect.any(Object),
    );
  });

  it('returns null on non-2xx', async () => {
    const fetcher = mockFetch({}, false);
    const r = await fetchFromFrankfurter(fetcher, 'USD', 'CNY', new Date('2025-06-15'));
    expect(r).toBeNull();
  });

  it('returns null on missing rate / non-finite', async () => {
    const a = await fetchFromFrankfurter(
      mockFetch({ rates: {} }),
      'USD',
      'CNY',
      new Date('2025-06-15'),
    );
    expect(a).toBeNull();

    const b = await fetchFromFrankfurter(
      mockFetch({ rates: { CNY: -1 } }),
      'USD',
      'CNY',
      new Date('2025-06-15'),
    );
    expect(b).toBeNull();
  });
});
