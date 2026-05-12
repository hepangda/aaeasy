import { afterEach, describe, it, expect, vi } from 'vitest';
import { hashPassword, verifyPassword } from './password';
import { generateSessionToken, hashSessionToken } from './tokens';
import { getInitialAllowedUsernames, isUsernameAllowed } from './username-allowlist';

const { allowedUsernameCountMock, allowedUsernameFindUniqueMock } = vi.hoisted(() => ({
  allowedUsernameCountMock: vi.fn(),
  allowedUsernameFindUniqueMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    $transaction: vi.fn((queries: unknown[]) => Promise.all(queries)),
    allowedUsername: {
      count: allowedUsernameCountMock,
      findUnique: allowedUsernameFindUniqueMock,
    },
  },
}));

const originalInitialAllowedUsernames = process.env.INITIAL_ALLOWED_USERNAMES;

afterEach(() => {
  if (originalInitialAllowedUsernames === undefined) {
    delete process.env.INITIAL_ALLOWED_USERNAMES;
  } else {
    process.env.INITIAL_ALLOWED_USERNAMES = originalInitialAllowedUsernames;
  }
});

describe('password', () => {
  it('hashes and verifies correctly', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(hash, 'correct horse battery staple')).toBe(true);
    expect(await verifyPassword(hash, 'wrong')).toBe(false);
  });

  it('produces different hashes for the same password (random salt)', async () => {
    const a = await hashPassword('hunter2hunter2');
    const b = await hashPassword('hunter2hunter2');
    expect(a).not.toEqual(b);
  });

  it('returns false on malformed hash without throwing', async () => {
    expect(await verifyPassword('not-a-real-hash', 'whatever')).toBe(false);
  });
});

describe('session tokens', () => {
  it('generates 256-bit base64url tokens', () => {
    const t = generateSessionToken();
    // 32 bytes -> 43 base64url chars (no padding)
    expect(t).toHaveLength(43);
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('hashes deterministically', () => {
    const a = hashSessionToken('abc');
    const b = hashSessionToken('abc');
    expect(a).toEqual(b);
    expect(a).toHaveLength(64);
  });

  it('produces unique tokens per call', () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generateSessionToken()));
    expect(tokens.size).toBe(100);
  });
});

describe('initial allowed usernames', () => {
  it('parses, normalizes, deduplicates, and filters env usernames', () => {
    process.env.INITIAL_ALLOWED_USERNAMES = 'Alice,bob; alice\nno ok xy valid-name';

    expect(getInitialAllowedUsernames()).toEqual(['alice', 'bob', 'valid-name']);
  });

  it('denies registration when env and database allowlists are both empty', async () => {
    delete process.env.INITIAL_ALLOWED_USERNAMES;
    allowedUsernameCountMock.mockResolvedValue(0);
    allowedUsernameFindUniqueMock.mockResolvedValue(null);

    await expect(isUsernameAllowed('alice')).resolves.toBe(false);
  });

  it('allows registration when username is present in the initial env allowlist', async () => {
    process.env.INITIAL_ALLOWED_USERNAMES = 'alice';
    allowedUsernameCountMock.mockResolvedValue(0);
    allowedUsernameFindUniqueMock.mockResolvedValue(null);

    await expect(isUsernameAllowed('Alice')).resolves.toBe(true);
  });
});
