import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../app-env';
import { ApiError, handleApiError } from '../lib/errors';

const mocks = vi.hoisted(() => ({
  requireGroupAccess: vi.fn(),
  boundMember: vi.fn(() => null),
  loadLedger: vi.fn(),
  serializeLedger: vi.fn(),
}));

vi.mock('../auth/access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth/access')>()),
  requireGroupAccess: mocks.requireGroupAccess,
  boundMember: mocks.boundMember,
}));

vi.mock('../services/ledger', () => ({
  loadLedger: mocks.loadLedger,
  serializeLedger: mocks.serializeLedger,
}));

import { expenseRoutes } from './expenses';

function createApp(db: AppEnv['Variables']['db']) {
  const app = new Hono<AppEnv>();
  app.use('/api/*', async (c, next) => {
    c.set('db', db);
    await next();
  });
  app.route('/api', expenseRoutes);
  app.onError(handleApiError);
  return app;
}

const unusedDb = new Proxy(
  {},
  {
    get() {
      throw new Error('database must not be touched');
    },
  },
) as AppEnv['Variables']['db'];

const group = {
  id: 'g1',
  name: 'Trip',
  defaultCurrency: 'CNY',
  status: 'ACTIVE',
  revision: 4n,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireGroupAccess.mockResolvedValue({
    access: {
      kind: 'user',
      userId: 'u1',
      role: 'OWNER',
      groupId: 'g1',
      linkedMemberId: 'm1',
      bypass: null,
    },
    group,
  });
});

describe('expense routes', () => {
  it('requests only the selected expense page for the ledger endpoint', async () => {
    const ledger = { group };
    const serialized = { group: { id: 'g1' }, expenses: [] };
    mocks.loadLedger.mockResolvedValue(ledger);
    mocks.serializeLedger.mockReturnValue(serialized);
    const pageDb = {} as AppEnv['Variables']['db'];

    const response = await createApp(pageDb).request('/api/groups/g1/ledger?page=3');

    expect(response.status).toBe(200);
    expect(mocks.loadLedger).toHaveBeenCalledWith(pageDb, group, {
      expensePage: { page: 3, pageSize: 10 },
    });
    await expect(response.json()).resolves.toEqual(serialized);
  });

  it('authorizes deletion before revealing expense state', async () => {
    mocks.requireGroupAccess.mockRejectedValue(new ApiError('UNAUTHORIZED', 401));

    const response = await createApp(unusedDb).request('/api/groups/g1/expenses/e1', {
      method: 'DELETE',
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'UNAUTHORIZED' });
  });

  it('authorizes valid updates before revealing expense state', async () => {
    mocks.requireGroupAccess.mockRejectedValue(new ApiError('UNAUTHORIZED', 401));

    const response = await createApp(unusedDb).request('/api/groups/g1/expenses/e1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        occurredAt: '2026-08-05T12:00:00.000Z',
        title: 'Dinner',
        currency: 'CNY',
        amount: '100',
        payerMemberId: 'm1',
        splitRule: { type: 'EQUAL', memberIds: ['m1'] },
        splitInputState: null,
        tags: [],
        expectedVersion: 1,
      }),
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'UNAUTHORIZED' });
  });
});
