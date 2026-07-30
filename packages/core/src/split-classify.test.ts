import { describe, expect, it } from 'vitest';
import { classifySplit } from './split-classify';
import type { SplitRule } from './split-types';

describe('classifySplit', () => {
  it('SOLO when only one person owes', () => {
    expect(classifySplit({ splits: [{ memberId: 'a', shareMinor: 100n }] })).toBe('SOLO');
  });

  it('EQUAL when all amounts match exactly', () => {
    expect(
      classifySplit({
        splits: [
          { memberId: 'a', shareMinor: 50n },
          { memberId: 'b', shareMinor: 50n },
        ],
      }),
    ).toBe('EQUAL');
  });

  it('EQUAL within LRM tail diff (10/3 → 334/333/333)', () => {
    expect(
      classifySplit({
        splits: [
          { memberId: 'a', shareMinor: 334n },
          { memberId: 'b', shareMinor: 333n },
          { memberId: 'c', shareMinor: 333n },
        ],
      }),
    ).toBe('EQUAL');
  });

  it('does not call a two-minor-unit difference equal', () => {
    expect(
      classifySplit({
        splits: [
          { memberId: 'a', shareMinor: 102n },
          { memberId: 'b', shareMinor: 100n },
        ],
      }),
    ).not.toBe('EQUAL');
  });

  it('RATIO for clean integer ratio (2:1:1)', () => {
    expect(
      classifySplit({
        splits: [
          { memberId: 'a', shareMinor: 200n },
          { memberId: 'b', shareMinor: 100n },
          { memberId: 'c', shareMinor: 100n },
        ],
      }),
    ).toBe('RATIO');
  });

  it('RATIO for 5:3:2 across various magnitudes', () => {
    expect(
      classifySplit({
        splits: [
          { memberId: 'a', shareMinor: 50000n },
          { memberId: 'b', shareMinor: 30000n },
          { memberId: 'c', shareMinor: 20000n },
        ],
      }),
    ).toBe('RATIO');
  });

  it('CUSTOM when amounts cannot fit a small ratio', () => {
    // 50/33/17 has gcd=1 with weights {50,33,17} > 10
    expect(
      classifySplit({
        splits: [
          { memberId: 'a', shareMinor: 5000n },
          { memberId: 'b', shareMinor: 3300n },
          { memberId: 'c', shareMinor: 1700n },
        ],
      }),
    ).toBe('CUSTOM');
  });

  it('CUSTOM when one member has an obvious "extra"', () => {
    // 50/30/30 with an extra of 8 on Bob → 50/38/30 → gcd=2, weights {25,19,15} > 10
    expect(
      classifySplit({
        splits: [
          { memberId: 'a', shareMinor: 5000n },
          { memberId: 'b', shareMinor: 3800n },
          { memberId: 'c', shareMinor: 3000n },
        ],
      }),
    ).toBe('CUSTOM');
  });

  it('uses splitRule.type to short-circuit when present', () => {
    const equalRule: SplitRule = { type: 'EQUAL', memberIds: ['a', 'b'] };
    expect(
      classifySplit({
        splits: [
          { memberId: 'a', shareMinor: 50n },
          { memberId: 'b', shareMinor: 50n },
        ],
        splitRule: equalRule,
      }),
    ).toBe('EQUAL');

    const subsetRule: SplitRule = { type: 'SUBSET', memberIds: ['a', 'b'] };
    expect(
      classifySplit({
        splits: [
          { memberId: 'a', shareMinor: 200n },
          { memberId: 'b', shareMinor: 100n },
        ],
        splitRule: subsetRule,
      }),
    ).toBe('EQUAL');

    const weighted: SplitRule = {
      type: 'WEIGHTED',
      weights: [
        { memberId: 'a', weight: '2' },
        { memberId: 'b', weight: '1' },
      ],
    };
    expect(
      classifySplit({
        // amounts that look equal but rule says ratio → trust rule
        splits: [
          { memberId: 'a', shareMinor: 100n },
          { memberId: 'b', shareMinor: 100n },
        ],
        splitRule: weighted,
      }),
    ).toBe('RATIO');
  });

  it('normalizes equivalent decimal weights before classifying', () => {
    const weighted: SplitRule = {
      type: 'WEIGHTED',
      weights: [
        { memberId: 'a', weight: '1' },
        { memberId: 'b', weight: '1.0' },
        { memberId: 'c', weight: '01.000' },
      ],
    };

    expect(
      classifySplit({
        splits: [
          { memberId: 'a', shareMinor: 34n },
          { memberId: 'b', shareMinor: 33n },
          { memberId: 'c', shareMinor: 33n },
        ],
        splitRule: weighted,
      }),
    ).toBe('EQUAL');
  });

  it('keeps an explicit equal rule equal when rounding leaves one non-zero share', () => {
    const equalRule: SplitRule = { type: 'EQUAL', memberIds: ['a', 'b', 'c'] };

    expect(
      classifySplit({
        splits: [
          { memberId: 'a', shareMinor: 1n },
          { memberId: 'b', shareMinor: 0n },
          { memberId: 'c', shareMinor: 0n },
        ],
        splitRule: equalRule,
      }),
    ).toBe('EQUAL');
  });
});
