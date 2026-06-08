import { describe, expect, it } from 'vitest';
import {
  buildSplitRows,
  mergeAiRows,
  normalizeAmount,
  normalizeCurrency,
  normalizeFxRate,
  normalizeOccurredAt,
  normalizeTags,
  resolveMemberId,
} from './ai-schema';

const MEMBERS = [
  { id: 'm-alice', displayName: 'Alice' },
  { id: 'm-bob', displayName: 'Bob' },
  { id: 'm-carol', displayName: 'Carol' },
];

describe('resolveMemberId', () => {
  it('matches case-insensitively', () => {
    expect(resolveMemberId('alice', MEMBERS)).toBe('m-alice');
    expect(resolveMemberId('ALICE', MEMBERS)).toBe('m-alice');
  });

  it('falls back to substring match', () => {
    expect(resolveMemberId('ali', MEMBERS)).toBe('m-alice');
  });

  it('returns null when not found', () => {
    expect(resolveMemberId('dave', MEMBERS)).toBeNull();
    expect(resolveMemberId('', MEMBERS)).toBeNull();
  });
});

describe('field normalizers', () => {
  it('normalizeAmount strips symbols and validates shape', () => {
    expect(normalizeAmount('87.50')).toBe('87.50');
    expect(normalizeAmount('$87.50')).toBe('87.50');
    expect(normalizeAmount(87.5)).toBe('87.5');
    expect(normalizeAmount('abc')).toBeNull();
    expect(normalizeAmount('')).toBeNull();
    expect(normalizeAmount(null)).toBeNull();
  });

  it('normalizeCurrency uppercases and validates ISO code', () => {
    expect(normalizeCurrency('cny')).toBe('CNY');
    expect(normalizeCurrency('  USD  ')).toBe('USD');
    expect(normalizeCurrency('US')).toBeNull();
    expect(normalizeCurrency('USDX')).toBeNull();
    expect(normalizeCurrency(42)).toBeNull();
  });

  it('normalizeOccurredAt extracts YYYY-MM-DD prefix', () => {
    expect(normalizeOccurredAt('2026-06-08')).toBe('2026-06-08');
    expect(normalizeOccurredAt('2026-06-08T12:00:00Z')).toBe('2026-06-08');
    expect(normalizeOccurredAt('06/08/2026')).toBeNull();
    expect(normalizeOccurredAt(null)).toBeNull();
  });

  it('normalizeFxRate accepts positive decimals', () => {
    expect(normalizeFxRate('7.2')).toBe('7.2');
    expect(normalizeFxRate(7.2)).toBe('7.2');
    expect(normalizeFxRate('abc')).toBeNull();
  });

  it('normalizeTags cleans + caps array', () => {
    expect(normalizeTags(['food', '  taxi  ', ''])).toEqual(['food', 'taxi']);
    expect(normalizeTags('food')).toBeNull();
    expect(normalizeTags([])).toBeNull();
  });
});

describe('buildSplitRows', () => {
  it('mode=equal with participants list checks matching members only', () => {
    const r = buildSplitRows({
      members: MEMBERS,
      split: { mode: 'equal', participants: ['Alice', 'Bob'] },
    });
    expect(r.mode).toBe('equal');
    expect(r.rows.map((x) => [x.memberId, x.checked, x.shares])).toEqual([
      ['m-alice', true, '1'],
      ['m-bob', true, '1'],
      ['m-carol', false, '0'],
    ]);
    expect(r.unresolvedParticipants).toEqual([]);
  });

  it('mode=equal without participants defaults to everyone', () => {
    const r = buildSplitRows({
      members: MEMBERS,
      split: { mode: 'equal' },
    });
    expect(r.rows.every((x) => x.checked && x.shares === '1')).toBe(true);
  });

  it('mode=shares uses the shares record', () => {
    const r = buildSplitRows({
      members: MEMBERS,
      split: {
        mode: 'shares',
        shares: { Alice: 2, Bob: 1 },
      },
    });
    expect(r.mode).toBe('shares');
    expect(r.rows.find((x) => x.memberId === 'm-alice')?.shares).toBe('2');
    expect(r.rows.find((x) => x.memberId === 'm-bob')?.shares).toBe('1');
    expect(r.rows.find((x) => x.memberId === 'm-carol')?.checked).toBe(false);
  });

  it('mode=custom drops everyone to unchecked + extras', () => {
    const r = buildSplitRows({
      members: MEMBERS,
      split: {
        mode: 'custom',
        extras: { Alice: '30', Bob: '57.50' },
      },
    });
    expect(r.mode).toBe('custom');
    expect(r.rows.find((x) => x.memberId === 'm-alice')).toEqual({
      memberId: 'm-alice',
      checked: false,
      shares: '0',
      extraText: '30',
    });
    expect(r.rows.find((x) => x.memberId === 'm-bob')?.extraText).toBe('57.50');
  });

  it('preserves negative extras (refund)', () => {
    const r = buildSplitRows({
      members: MEMBERS,
      split: {
        mode: 'equal',
        extras: { Alice: '-20' },
      },
    });
    expect(r.rows.find((x) => x.memberId === 'm-alice')?.extraText).toBe('-20');
  });

  it('reports unresolved names', () => {
    const r = buildSplitRows({
      members: MEMBERS,
      split: {
        mode: 'equal',
        participants: ['Alice', 'Dave'],
      },
    });
    expect(r.unresolvedParticipants).toEqual(['Dave']);
    expect(r.rows.find((x) => x.memberId === 'm-alice')?.checked).toBe(true);
  });
});

describe('mergeAiRows', () => {
  it('only touches checked / shares / extraText', () => {
    const prev = [
      {
        memberId: 'm-alice',
        checked: false,
        shares: '0',
        baseText: 'preserved',
        extraText: '',
      },
      {
        memberId: 'm-bob',
        checked: true,
        shares: '3',
        baseText: 'also-preserved',
        extraText: '5',
      },
    ];
    const ai = [
      { memberId: 'm-alice', checked: true, shares: '1', extraText: '' },
      { memberId: 'm-bob', checked: true, shares: '2', extraText: '0' },
    ];
    const out = mergeAiRows(prev, ai);
    expect(out[0]).toEqual({
      memberId: 'm-alice',
      checked: true,
      shares: '1',
      baseText: 'preserved',
      extraText: '',
    });
    expect(out[1]).toEqual({
      memberId: 'm-bob',
      checked: true,
      shares: '2',
      baseText: 'also-preserved',
      extraText: '0',
    });
  });

  it('leaves rows without an AI match untouched', () => {
    const prev = [
      {
        memberId: 'm-alice',
        checked: false,
        shares: '0',
        baseText: 'x',
        extraText: '',
      },
      {
        memberId: 'm-bob',
        checked: false,
        shares: '0',
        baseText: 'y',
        extraText: '',
      },
    ];
    const out = mergeAiRows(prev, [
      { memberId: 'm-alice', checked: true, shares: '1', extraText: '' },
    ]);
    expect(out[1]).toBe(prev[1]);
  });
});
