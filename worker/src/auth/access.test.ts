import { describe, expect, it } from 'vitest';
import { isAllowed, type GroupAccess, type GroupAction } from './access';

const actions: GroupAction[] = [
  'READ_GROUP',
  'WRITE_EXPENSE',
  'MANAGE_MEMBERS',
  'MANAGE_SHARES',
  'SETTLE',
  'DELETE_GROUP',
];

function allowedActions(access: GroupAccess): GroupAction[] {
  return actions.filter((action) => isAllowed(access, action));
}

describe('group access matrix', () => {
  it('grants owners every group action', () => {
    expect(
      allowedActions({
        kind: 'user',
        userId: 'owner',
        groupId: 'group',
        role: 'OWNER',
        linkedMemberId: null,
        bypass: null,
      }),
    ).toEqual(actions);
  });

  it('does not allow managers to delete the group', () => {
    expect(
      allowedActions({
        kind: 'user',
        userId: 'manager',
        groupId: 'group',
        role: 'MANAGER',
        linkedMemberId: null,
        bypass: null,
      }),
    ).toEqual(actions.filter((action) => action !== 'DELETE_GROUP'));
  });

  it('only allows linked members to read and write expenses', () => {
    const base = {
      kind: 'user' as const,
      userId: 'member',
      groupId: 'group',
      role: 'MEMBER' as const,
      bypass: null,
    };
    expect(allowedActions({ ...base, linkedMemberId: 'member-row' })).toEqual([
      'READ_GROUP',
      'WRITE_EXPENSE',
    ]);
    expect(allowedActions({ ...base, linkedMemberId: null })).toEqual(['READ_GROUP']);
  });

  it('does not grant write access to read-only share sessions', () => {
    const base = {
      kind: 'share' as const,
      shareLinkId: 'share',
      groupId: 'group',
      boundMemberId: null,
    };
    expect(allowedActions({ ...base, scope: 'READ' })).toEqual(['READ_GROUP']);
    expect(allowedActions({ ...base, scope: 'WRITE' })).toEqual(['READ_GROUP', 'WRITE_EXPENSE']);
  });
});
