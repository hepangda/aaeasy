import { describe, expect, it } from 'vitest';
import { computeSplit, SplitError } from './index';
import type { SplitRule } from './types';

function totalOf(m: Map<string, bigint>): bigint {
  let s = 0n;
  for (const v of m.values()) s += v;
  return s;
}

describe('computeSplit / EQUAL', () => {
  it('classic 10/3 case (CNY: 1000 fen ÷ 3)', () => {
    const r = computeSplit({
      totalMinor: 1000n,
      rule: { type: 'EQUAL', memberIds: ['a', 'b', 'c'] },
    });
    // 1000 / 3 = 333.33… → 333, 333, 334 (LRM: c gets the +1 since fracs all .333…
    // but ties broken by id-asc → a, then b, then c. With remainder=1, only one
    // gets the +1, and that's the FIRST in id-asc order = 'a'.)
    expect(totalOf(r)).toBe(1000n);
    expect(r.get('a')).toBe(334n);
    expect(r.get('b')).toBe(333n);
    expect(r.get('c')).toBe(333n);
  });

  it('exact divide leaves no remainder', () => {
    const r = computeSplit({
      totalMinor: 900n,
      rule: { type: 'EQUAL', memberIds: ['a', 'b', 'c'] },
    });
    expect(r.get('a')).toBe(300n);
    expect(r.get('b')).toBe(300n);
    expect(r.get('c')).toBe(300n);
  });

  it('1 cent across 3 → one penny', () => {
    const r = computeSplit({
      totalMinor: 1n,
      rule: { type: 'EQUAL', memberIds: ['a', 'b', 'c'] },
    });
    expect(totalOf(r)).toBe(1n);
    // Largest fractional part among floor(1/3)=0 base: each frac = 0.333…
    // First by id-asc gets +1 ⇒ 'a'.
    expect(r.get('a')).toBe(1n);
    expect(r.get('b')).toBe(0n);
    expect(r.get('c')).toBe(0n);
  });

  it('zero amount produces all zeros', () => {
    const r = computeSplit({
      totalMinor: 0n,
      rule: { type: 'EQUAL', memberIds: ['a', 'b', 'c'] },
    });
    expect(totalOf(r)).toBe(0n);
    for (const v of r.values()) expect(v).toBe(0n);
  });

  it('single member gets the full amount', () => {
    const r = computeSplit({
      totalMinor: 12345n,
      rule: { type: 'EQUAL', memberIds: ['a'] },
    });
    expect(r.get('a')).toBe(12345n);
  });

  it('deduplicates memberIds', () => {
    const r = computeSplit({
      totalMinor: 1000n,
      rule: { type: 'EQUAL', memberIds: ['a', 'b', 'b', 'c'] },
    });
    expect(r.size).toBe(3);
    expect(totalOf(r)).toBe(1000n);
  });

  it('throws on empty participants', () => {
    expect(() =>
      computeSplit({
        totalMinor: 100n,
        rule: { type: 'EQUAL', memberIds: [] },
      }),
    ).toThrow(SplitError);
  });

  it('throws on negative total', () => {
    expect(() =>
      computeSplit({
        totalMinor: -1n,
        rule: { type: 'EQUAL', memberIds: ['a'] },
      }),
    ).toThrow(SplitError);
  });

  it('throws on UNKNOWN_MEMBER when validMemberIds is given', () => {
    expect(() =>
      computeSplit({
        totalMinor: 100n,
        rule: { type: 'EQUAL', memberIds: ['x'] },
        validMemberIds: new Set(['a', 'b']),
      }),
    ).toThrow(/UNKNOWN_MEMBER/);
  });
});

describe('computeSplit / SUBSET', () => {
  it('only specified members owe', () => {
    const r = computeSplit({
      totalMinor: 999n,
      rule: { type: 'SUBSET', memberIds: ['b', 'c'] },
    });
    expect(r.size).toBe(2);
    expect(totalOf(r)).toBe(999n);
    // 999/2 = 499.5 → floor 499 each, remainder 1, LRM gives +1 to id-asc first.
    // ties broken by id-asc → 'b'
    expect(r.get('b')).toBe(500n);
    expect(r.get('c')).toBe(499n);
  });

  it('subset of one is fine', () => {
    const r = computeSplit({
      totalMinor: 555n,
      rule: { type: 'SUBSET', memberIds: ['only'] },
    });
    expect(r.get('only')).toBe(555n);
  });
});

describe('computeSplit / WEIGHTED', () => {
  it('handles 2:1:1 across 100 cents', () => {
    const rule: SplitRule = {
      type: 'WEIGHTED',
      weights: [
        { memberId: 'a', weight: '2' },
        { memberId: 'b', weight: '1' },
        { memberId: 'c', weight: '1' },
      ],
    };
    const r = computeSplit({ totalMinor: 100n, rule });
    expect(totalOf(r)).toBe(100n);
    expect(r.get('a')).toBe(50n);
    expect(r.get('b')).toBe(25n);
    expect(r.get('c')).toBe(25n);
  });

  it('handles fractional weights', () => {
    const rule: SplitRule = {
      type: 'WEIGHTED',
      weights: [
        { memberId: 'a', weight: '1.5' },
        { memberId: 'b', weight: '1' },
        { memberId: 'c', weight: '0.5' },
      ],
    };
    const r = computeSplit({ totalMinor: 1000n, rule });
    expect(totalOf(r)).toBe(1000n);
    // a:0.5, b:0.333…, c:0.166… → 500, 333, 167; remainder=0 (sums to 1000? 500+333+167=1000 ✓)
    expect(r.get('a')).toBe(500n);
    expect(r.get('b')).toBe(333n);
    expect(r.get('c')).toBe(167n);
  });

  it('roundingToPayer routes the entire remainder to the payer', () => {
    const rule: SplitRule = {
      type: 'WEIGHTED',
      weights: [
        { memberId: 'a', weight: '1' },
        { memberId: 'b', weight: '1' },
        { memberId: 'c', weight: '1' },
      ],
      roundingToPayer: true,
    };
    const r = computeSplit({
      totalMinor: 1000n,
      rule,
      payerMemberId: 'b',
    });
    expect(totalOf(r)).toBe(1000n);
    expect(r.get('a')).toBe(333n);
    expect(r.get('b')).toBe(334n);
    expect(r.get('c')).toBe(333n);
  });

  it('zero-weight member is excluded', () => {
    const rule: SplitRule = {
      type: 'WEIGHTED',
      weights: [
        { memberId: 'a', weight: '1' },
        { memberId: 'b', weight: '0' },
        { memberId: 'c', weight: '1' },
      ],
    };
    const r = computeSplit({ totalMinor: 100n, rule });
    expect(r.has('b')).toBe(false);
    expect(r.get('a')).toBe(50n);
    expect(r.get('c')).toBe(50n);
  });

  it('throws on negative weight', () => {
    expect(() =>
      computeSplit({
        totalMinor: 100n,
        rule: {
          type: 'WEIGHTED',
          weights: [
            { memberId: 'a', weight: '-1' },
            { memberId: 'b', weight: '1' },
          ],
        },
      }),
    ).toThrow(/NEGATIVE_WEIGHT/);
  });

  it('throws when all weights are zero (no participants)', () => {
    expect(() =>
      computeSplit({
        totalMinor: 100n,
        rule: {
          type: 'WEIGHTED',
          weights: [
            { memberId: 'a', weight: '0' },
            { memberId: 'b', weight: '0' },
          ],
        },
      }),
    ).toThrow(/NO_PARTICIPANTS|ZERO_WEIGHT/);
  });

  it('throws on duplicate member', () => {
    expect(() =>
      computeSplit({
        totalMinor: 100n,
        rule: {
          type: 'WEIGHTED',
          weights: [
            { memberId: 'a', weight: '1' },
            { memberId: 'a', weight: '1' },
          ],
        },
      }),
    ).toThrow(/DUPLICATE_MEMBER/);
  });
});

describe('computeSplit / EXACT', () => {
  it('returns the supplied amounts unchanged when sum matches', () => {
    const r = computeSplit({
      totalMinor: 1000n,
      rule: {
        type: 'EXACT',
        amounts: [
          { memberId: 'a', amountMinor: '400' },
          { memberId: 'b', amountMinor: '600' },
        ],
      },
    });
    expect(r.get('a')).toBe(400n);
    expect(r.get('b')).toBe(600n);
  });

  it('drops zero-amount entries', () => {
    const r = computeSplit({
      totalMinor: 100n,
      rule: {
        type: 'EXACT',
        amounts: [
          { memberId: 'a', amountMinor: '100' },
          { memberId: 'b', amountMinor: '0' },
        ],
      },
    });
    expect(r.has('b')).toBe(false);
    expect(r.get('a')).toBe(100n);
  });

  it('throws SUM_MISMATCH when amounts do not equal total', () => {
    expect(() =>
      computeSplit({
        totalMinor: 1000n,
        rule: {
          type: 'EXACT',
          amounts: [
            { memberId: 'a', amountMinor: '300' },
            { memberId: 'b', amountMinor: '600' },
          ],
        },
      }),
    ).toThrow(/SUM_MISMATCH/);
  });

  it('throws on duplicate member', () => {
    expect(() =>
      computeSplit({
        totalMinor: 100n,
        rule: {
          type: 'EXACT',
          amounts: [
            { memberId: 'a', amountMinor: '50' },
            { memberId: 'a', amountMinor: '50' },
          ],
        },
      }),
    ).toThrow(/DUPLICATE_MEMBER/);
  });

  it('throws on UNKNOWN_MEMBER when validMemberIds is given', () => {
    expect(() =>
      computeSplit({
        totalMinor: 100n,
        rule: {
          type: 'EXACT',
          amounts: [{ memberId: 'x', amountMinor: '100' }],
        },
        validMemberIds: new Set(['a']),
      }),
    ).toThrow(/UNKNOWN_MEMBER/);
  });
});

describe('computeSplit / large randomized invariant', () => {
  it('always sums exactly to total for 200 random shapes', () => {
    let seed = 42;
    const rand = () => {
      // Mulberry32
      seed = (seed + 0x6d2b79f5) >>> 0;
      let t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let i = 0; i < 200; i++) {
      const n = 1 + Math.floor(rand() * 10);
      const memberIds = Array.from({ length: n }, (_, j) => `m${j}`);
      const total = BigInt(Math.floor(rand() * 1_000_000));
      const r = computeSplit({
        totalMinor: total,
        rule: { type: 'EQUAL', memberIds },
      });
      expect(totalOf(r)).toBe(total);
      // Differences between any two shares ≤ 1 minor unit.
      const vals = [...r.values()];
      const min = vals.reduce((a, b) => (a < b ? a : b));
      const max = vals.reduce((a, b) => (a > b ? a : b));
      expect(max - min <= 1n).toBe(true);
    }
  });
});
