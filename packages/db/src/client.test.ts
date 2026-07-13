import { beforeEach, describe, expect, it, vi } from 'vitest';

const { drizzleMock, postgresMock } = vi.hoisted(() => ({
  drizzleMock: vi.fn((client: unknown) => ({ client })),
  postgresMock: vi.fn(() => ({})),
}));

vi.mock('drizzle-orm/postgres-js', () => ({ drizzle: drizzleMock }));
vi.mock('postgres', () => ({ default: postgresMock }));

import { createDatabase } from './client';

describe('createDatabase', () => {
  beforeEach(() => {
    drizzleMock.mockClear();
    postgresMock.mockClear();
  });

  it('creates a request-scoped Postgres client for every invocation', () => {
    createDatabase('postgresql://example.test/database');
    createDatabase('postgresql://example.test/database');

    expect(postgresMock).toHaveBeenCalledTimes(2);
    expect(drizzleMock).toHaveBeenCalledTimes(2);
    expect(drizzleMock.mock.calls[0]?.[0]).not.toBe(drizzleMock.mock.calls[1]?.[0]);
  });
});
