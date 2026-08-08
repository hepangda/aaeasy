import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../app-env';
import { ApiError, handleApiError } from '../lib/errors';

const mocks = vi.hoisted(() => ({
  requireGroupAccess: vi.fn(),
  boundMember: vi.fn(() => null),
}));

vi.mock('../auth/access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth/access')>()),
  requireGroupAccess: mocks.requireGroupAccess,
  boundMember: mocks.boundMember,
}));

import { settlementRoutes } from './settlements';

function createApp(db: AppEnv['Variables']['db']) {
  const app = new Hono<AppEnv>();
  app.use('/api/*', async (c, next) => {
    c.set('db', db);
    await next();
  });
  app.route('/api', settlementRoutes);
  app.onError(handleApiError);
  return app;
}

function groupStateDatabase(group: Record<string, unknown>) {
  const forUpdate = vi.fn(async () => [group]);
  const builder = {
    from: vi.fn(() => builder),
    where: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    for: forUpdate,
  };
  const tx = { select: vi.fn(() => builder) };
  const transaction = vi.fn(
    async (callback: (transaction: typeof tx) => Promise<unknown>, _config: unknown) =>
      callback(tx),
  );
  return {
    db: { transaction } as unknown as AppEnv['Variables']['db'],
    transaction,
    forUpdate,
  };
}

const unusedDb = new Proxy(
  {},
  {
    get() {
      throw new Error('database must not be touched');
    },
  },
) as AppEnv['Variables']['db'];

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
    group: {
      id: 'g1',
      name: 'Trip',
      defaultCurrency: 'CNY',
      status: 'ACTIVE',
      revision: 4n,
    },
  });
});

describe('settlement routes', () => {
  it('locks and rechecks ledger state inside a serializable settlement transaction', async () => {
    const state = groupStateDatabase({
      id: 'g1',
      name: 'Osaka trip',
      defaultCurrency: 'CNY',
      status: 'ARCHIVED',
    });

    const response = await createApp(state.db).request('/api/groups/g1/settlements', {
      method: 'POST',
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'errors.nothing_to_settle',
    });
    expect(state.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'serializable',
      accessMode: 'read write',
    });
    expect(state.forUpdate).toHaveBeenCalledWith('update');
  });

  it('refuses reopening unless the locked ledger is archived', async () => {
    const state = groupStateDatabase({ status: 'ACTIVE' });

    const response = await createApp(state.db).request('/api/groups/g1/settlements/s1/reopen', {
      method: 'POST',
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'errors.conflict' });
    expect(state.forUpdate).toHaveBeenCalledWith('update');
  });

  it('authorizes entry deletion before revealing entry state', async () => {
    mocks.requireGroupAccess.mockRejectedValue(new ApiError('UNAUTHORIZED', 401));

    const response = await createApp(unusedDb).request('/api/groups/g1/settlement-entries/e1', {
      method: 'DELETE',
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'UNAUTHORIZED' });
  });
});
