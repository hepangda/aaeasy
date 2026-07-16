import { describe, expect, it } from 'vitest';
import { inviteMemberSchema, memberChipSchema } from './groups';

describe('KeyForge alias validation', () => {
  it.each(['A', 'Pangda42', 'a'.repeat(64)])('accepts alias %s', (alias) => {
    expect(
      inviteMemberSchema.parse({ memberId: 'member', username: alias, assignedRole: 'MEMBER' })
        .username,
    ).toBe(alias.toLowerCase());
    expect(memberChipSchema.safeParse({ kind: 'mention', username: alias }).success).toBe(true);
  });

  it.each(['alias-name', 'alias_name', 'alias.name', 'a'.repeat(65)])(
    'rejects non-KeyForge alias %s',
    (alias) => {
      expect(
        inviteMemberSchema.safeParse({
          memberId: 'member',
          username: alias,
          assignedRole: 'MEMBER',
        }).success,
      ).toBe(false);
      expect(memberChipSchema.safeParse({ kind: 'mention', username: alias }).success).toBe(false);
    },
  );
});
