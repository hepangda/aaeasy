import { describe, expect, it } from 'vitest';
import {
  equalSplitRows,
  rowsFromDefaults,
  toggleAllRows,
  totalsFromRows,
  withChecked,
  withShares,
  type SplitRow,
} from './split-rows';

const MEMBERS = [
  { id: 'a', displayName: 'A' },
  { id: 'b', displayName: 'B' },
];

function row(overrides: Partial<SplitRow> & { memberId: string }): SplitRow {
  return { checked: true, shares: '1', baseText: '', extraText: '', ...overrides };
}

describe('rowsFromDefaults', () => {
  it('checks everyone for a brand-new expense', () => {
    expect(rowsFromDefaults(null, null, MEMBERS, 0n, 'CNY')).toEqual([
      row({ memberId: 'a' }),
      row({ memberId: 'b' }),
    ]);
  });

  it('restores the saved editor state verbatim', () => {
    const state = {
      rows: [
        { memberId: 'a', checked: true, shares: '2', extraText: '5.00' },
        { memberId: 'b', checked: false, shares: '0', extraText: '' },
      ],
    };
    expect(rowsFromDefaults(state, null, MEMBERS, 0n, 'CNY')).toEqual([
      row({ memberId: 'a', shares: '2', extraText: '5.00' }),
      row({ memberId: 'b', checked: false, shares: '0' }),
    ]);
  });

  it('turns a subset rule into checked rows', () => {
    expect(
      rowsFromDefaults(null, { type: 'SUBSET', memberIds: ['b'] }, MEMBERS, 0n, 'CNY'),
    ).toEqual([row({ memberId: 'a', checked: false, shares: '0' }), row({ memberId: 'b' })]);
  });

  it('drops exact amounts into the extras column so the totals reconcile', () => {
    const rows = rowsFromDefaults(
      null,
      { type: 'EXACT', amounts: [{ memberId: 'a', amountMinor: '1234' }] },
      MEMBERS,
      1234n,
      'CNY',
    );
    expect(rows[0]).toEqual(
      row({ memberId: 'a', checked: false, shares: '0', extraText: '12.34' }),
    );
    expect(rows[1]).toEqual(row({ memberId: 'b', checked: false, shares: '0' }));
  });
});

describe('totalsFromRows', () => {
  it('adds extras for unchecked members too', () => {
    const totals = totalsFromRows(
      [
        row({ memberId: 'a', baseText: '10.00', extraText: '1.50' }),
        row({ memberId: 'b', checked: false, extraText: '2.00' }),
      ],
      'CNY',
    );
    expect(totals).toEqual({
      sumMinor: 1350n,
      perMemberFinal: [1150n, 200n],
      anyParseError: false,
    });
  });

  it('flags input it cannot parse rather than guessing', () => {
    expect(totalsFromRows([row({ memberId: 'a', baseText: 'abc' })], 'CNY').anyParseError).toBe(
      true,
    );
  });

  it('flags a member whose extras push their share negative', () => {
    const totals = totalsFromRows(
      [row({ memberId: 'a', baseText: '1.00', extraText: '-2.00' })],
      'CNY',
    );
    expect(totals.anyParseError).toBe(true);
  });
});

describe('row edits keep "checked ↔ shares > 0"', () => {
  it('unchecks a row dropped to zero shares', () => {
    const [a] = withShares([row({ memberId: 'a', shares: '1' })], 'a', 0);
    expect(a).toEqual(row({ memberId: 'a', checked: false, shares: '0' }));
  });

  it('bumps a zero-share row back to one when checked', () => {
    const [a] = withChecked([row({ memberId: 'a', checked: false, shares: '0' })], 'a', true);
    expect(a).toEqual(row({ memberId: 'a', shares: '1' }));
  });

  it('selects all when anyone is unchecked, and deselects when all are', () => {
    const mixed = [row({ memberId: 'a' }), row({ memberId: 'b', checked: false, shares: '0' })];
    expect(toggleAllRows(mixed).every((r) => r.checked)).toBe(true);
    expect(toggleAllRows(toggleAllRows(mixed)).some((r) => r.checked)).toBe(false);
  });

  it('clears extras when resetting the checked rows to an equal share', () => {
    const rows = [
      row({ memberId: 'a', shares: '3', extraText: '9.99' }),
      row({ memberId: 'b', checked: false, shares: '0', extraText: '1.00' }),
    ];
    expect(equalSplitRows(rows)).toEqual([
      row({ memberId: 'a', shares: '1' }),
      row({ memberId: 'b', checked: false, shares: '0', extraText: '1.00' }),
    ]);
  });
});
