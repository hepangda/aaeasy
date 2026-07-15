import { describe, expect, it } from 'vitest';
import { classifyPersistedSplit, describeSplitIntent } from './intent';
import type { SplitInputState } from './input-state';

const rows = (
  values: Array<[memberId: string, checked: boolean, shares: string, extraText?: string]>,
) =>
  values.map(([memberId, checked, shares, extraText = '']) => ({
    memberId,
    checked,
    shares,
    extraText,
  }));

describe('describeSplitIntent', () => {
  it('keeps an equal split across a selected subset classified as equal', () => {
    const result = describeSplitIntent(
      rows([
        ['a', true, '1'],
        ['b', true, '1'],
        ['c', false, '0'],
      ]),
      ['a', 'b'],
    );

    expect(result).toEqual({ kind: 'EQUAL', participantIds: ['a', 'b'], ratio: [1, 1] });
  });

  it('reports unequal integer shares as their reduced ratio', () => {
    const result = describeSplitIntent(
      rows([
        ['a', true, '4'],
        ['b', true, '2'],
        ['c', true, '2'],
      ]),
    );

    expect(result).toEqual({
      kind: 'RATIO',
      participantIds: ['a', 'b', 'c'],
      ratio: [2, 1, 1],
    });
  });

  it('normalizes equal non-one shares to an equal split', () => {
    expect(
      describeSplitIntent(
        rows([
          ['a', true, '2'],
          ['b', true, '2'],
        ]),
      ),
    ).toEqual({ kind: 'EQUAL', participantIds: ['a', 'b'], ratio: [1, 1] });
  });

  it('reports any non-zero per-person extra as custom', () => {
    expect(
      describeSplitIntent(
        rows([
          ['a', true, '1', '0'],
          ['b', true, '1', '5.00'],
        ]),
      ).kind,
    ).toBe('CUSTOM');
  });

  it('reports a negative per-person extra as custom', () => {
    expect(
      describeSplitIntent(
        rows([
          ['a', true, '1', '-5'],
          ['b', true, '1'],
        ]),
      ).kind,
    ).toBe('CUSTOM');
  });

  it.each(['0', '0.00', '-0', '0,00'])('does not treat %s as a material extra', (extra) => {
    expect(
      describeSplitIntent(
        rows([
          ['a', true, '1', extra],
          ['b', true, '1'],
        ]),
      ).kind,
    ).toBe('EQUAL');
  });

  it('treats explicit per-person amounts restored into extras as custom', () => {
    expect(
      describeSplitIntent(
        rows([
          ['a', false, '0', '60'],
          ['b', false, '0', '40'],
        ]),
        ['a', 'b'],
      ).kind,
    ).toBe('CUSTOM');
  });

  it('reports a single participant as solo', () => {
    expect(describeSplitIntent(rows([['a', true, '1']])).kind).toBe('SOLO');
  });
});

describe('classifyPersistedSplit', () => {
  it('uses the saved editor intent instead of guessing from EXACT amounts', () => {
    const splitInputState: SplitInputState = {
      rows: rows([
        ['a', true, '2'],
        ['b', true, '1'],
      ]),
    };

    expect(
      classifyPersistedSplit({
        splits: [
          { memberId: 'a', shareMinor: 67n },
          { memberId: 'b', shareMinor: 33n },
        ],
        splitRule: {
          type: 'EXACT',
          amounts: [
            { memberId: 'a', amountMinor: '67' },
            { memberId: 'b', amountMinor: '33' },
          ],
        },
        splitInputState,
      }),
    ).toBe('RATIO');
  });

  it('keeps extras custom even when final amounts look like a clean ratio', () => {
    const splitInputState: SplitInputState = {
      rows: rows([
        ['a', true, '1', '20'],
        ['b', true, '1'],
        ['c', true, '1'],
      ]),
    };

    expect(
      classifyPersistedSplit({
        splits: [
          { memberId: 'a', shareMinor: 200n },
          { memberId: 'b', shareMinor: 100n },
          { memberId: 'c', shareMinor: 100n },
        ],
        splitInputState,
      }),
    ).toBe('CUSTOM');
  });

  it('keeps tiny equal splits equal when rounding leaves one non-zero amount', () => {
    const splitInputState: SplitInputState = {
      rows: rows([
        ['a', true, '1'],
        ['b', true, '1'],
        ['c', true, '1'],
      ]),
    };

    expect(
      classifyPersistedSplit({
        splits: [
          { memberId: 'a', shareMinor: 1n },
          { memberId: 'b', shareMinor: 0n },
          { memberId: 'c', shareMinor: 0n },
        ],
        splitInputState,
      }),
    ).toBe('EQUAL');
  });

  it('falls back to amount classification when the saved input state is incomplete', () => {
    const splitInputState: SplitInputState = {
      rows: rows([['a', true, '1']]),
    };

    expect(
      classifyPersistedSplit({
        splits: [
          { memberId: 'a', shareMinor: 200n },
          { memberId: 'b', shareMinor: 100n },
        ],
        splitInputState,
      }),
    ).toBe('RATIO');
  });
});
