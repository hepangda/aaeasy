import { describe, expect, it } from 'vitest';
import { affectedQueryKeys } from './use-group-stream';

describe('affectedQueryKeys', () => {
  it('keeps an expense write off the group-detail cache', () => {
    // The common case by a wide margin: it must not fan out to queries that
    // carry members, share links or invitations.
    for (const type of ['expense.created', 'expense.updated', 'expense.deleted'] as const) {
      expect(affectedQueryKeys(type, 'g1')).toEqual([['ledger', 'g1']]);
    }
  });

  it('refreshes the group when membership or settlement state changes', () => {
    expect(affectedQueryKeys('member.changed', 'g1')).toEqual([
      ['ledger', 'g1'],
      ['group', 'g1'],
    ]);
    expect(affectedQueryKeys('settlement.changed', 'g1')).toEqual([
      ['ledger', 'g1'],
      ['group', 'g1'],
    ]);
  });

  it('refreshes the ledger list too when the group itself changes', () => {
    expect(affectedQueryKeys('group.updated', 'g1')).toEqual([
      ['ledger', 'g1'],
      ['group', 'g1'],
      ['groups'],
    ]);
  });
});
