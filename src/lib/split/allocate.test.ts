import { describe, expect, it } from 'vitest';
import { distribute, parseMajorMinor, parseSignedMajorMinor } from './allocate';

describe('distribute', () => {
  it('splits evenly when it divides cleanly', () => {
    expect(distribute(300n, [1, 1, 1])).toEqual([100n, 100n, 100n]);
  });

  it('never loses or invents a minor unit', () => {
    for (const [total, weights] of [
      [100n, [1, 1, 1]],
      [1000n, [3, 5, 7]],
      [1n, [1, 1, 1, 1]],
      [99999n, [1, 2, 3, 4, 5, 6, 7]],
    ] as const) {
      const parts = distribute(total, [...weights]);
      expect(parts.reduce((a, b) => a + b, 0n)).toBe(total);
    }
  });

  it('gives the remainder to the largest fractional parts', () => {
    // 100 / 3 = 33.33 each; the two largest remainders get the extra unit.
    expect(distribute(100n, [1, 1, 1])).toEqual([34n, 33n, 33n]);
  });

  it('breaks ties by index so results are stable across renders', () => {
    expect(distribute(10n, [1, 1, 1])).toEqual(distribute(10n, [1, 1, 1]));
    expect(distribute(10n, [1, 1, 1])).toEqual([4n, 3n, 3n]);
  });

  it('respects weights', () => {
    expect(distribute(400n, [3, 1])).toEqual([300n, 100n]);
  });

  it('gives zero-weight participants nothing', () => {
    expect(distribute(100n, [1, 0, 1])).toEqual([50n, 0n, 50n]);
  });

  it('handles degenerate inputs', () => {
    expect(distribute(0n, [1, 1])).toEqual([0n, 0n]);
    expect(distribute(-5n, [1, 1])).toEqual([0n, 0n]);
    expect(distribute(100n, [0, 0])).toEqual([0n, 0n]);
  });
});

describe('parseMajorMinor', () => {
  it('treats empty as zero and garbage as null', () => {
    expect(parseMajorMinor('', 'CNY')).toBe(0n);
    expect(parseMajorMinor('   ', 'CNY')).toBe(0n);
    expect(parseMajorMinor('abc', 'CNY')).toBeNull();
  });

  it('parses major units into minor', () => {
    expect(parseMajorMinor('12.34', 'CNY')).toBe(1234n);
  });
});

describe('parseSignedMajorMinor', () => {
  it('accepts negatives for refunds and discounts', () => {
    expect(parseSignedMajorMinor('-12.34', 'CNY')).toBe(-1234n);
  });

  it('accepts the typographic minus so display text can be pasted back', () => {
    expect(parseSignedMajorMinor('−12.34', 'CNY')).toBe(-1234n);
  });

  it('rejects a bare sign', () => {
    expect(parseSignedMajorMinor('-', 'CNY')).toBeNull();
  });
});
