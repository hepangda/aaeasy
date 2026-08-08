import { afterEach, describe, expect, it, vi } from 'vitest';
import { actionRequest, groupAndListQueryKeys, groupQueryKeys, ledgerQueryKeys } from './api';
import { queryClient } from './query-client';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function stubFetch(response: () => Response | Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(response));
}

function successfulFetch() {
  stubFetch(async () =>
    Response.json({ ok: true }, { headers: { 'Content-Type': 'application/json' } }),
  );
}

describe('actionRequest cache invalidation', () => {
  it('invalidates only the query prefixes declared by the mutation', async () => {
    successfulFetch();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);

    await actionRequest('/api/groups/g1/expenses', { method: 'POST' }, groupQueryKeys('g1'));

    expect(invalidate.mock.calls).toEqual([
      [{ queryKey: ['group', 'g1'] }],
      [{ queryKey: ['ledger', 'g1'] }],
    ]);
  });

  it('keeps an expense write off the group and ledger-list caches', () => {
    // The hot path: writing an expense changes neither the member list nor
    // anything the ledger index renders.
    expect(ledgerQueryKeys('g1')).toEqual([['ledger', 'g1']]);
    expect(groupAndListQueryKeys('g1')).toEqual([['group', 'g1'], ['ledger', 'g1'], ['groups']]);
  });

  it('does not invalidate unrelated queries when no keys are declared', async () => {
    successfulFetch();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);

    await actionRequest('/api/auth/logout', { method: 'POST' });

    expect(invalidate).not.toHaveBeenCalled();
  });
});

describe('actionRequest failure reporting', () => {
  it('keeps the error the server sent, along with its status', async () => {
    stubFetch(async () =>
      Response.json(
        { ok: false, error: 'errors.member_name_taken' },
        { status: 409, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await expect(actionRequest('/api/groups/g1/members', { method: 'POST' })).resolves.toEqual({
      ok: false,
      error: 'errors.member_name_taken',
      status: 409,
    });
  });

  it('reports an error body that is not action-shaped', async () => {
    stubFetch(async () =>
      Response.json(
        { error: 'FORBIDDEN' },
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await expect(actionRequest('/api/groups/g1/members', { method: 'POST' })).resolves.toEqual({
      ok: false,
      error: 'FORBIDDEN',
      status: 403,
    });
  });

  it('distinguishes a request that never landed from one the server refused', async () => {
    // Both used to collapse into `errors.unknown`, which left the caller
    // unable to tell "the server said no" from "your connection dropped".
    stubFetch(async () => {
      throw new TypeError('Failed to fetch');
    });

    await expect(actionRequest('/api/groups/g1/members', { method: 'POST' })).resolves.toEqual({
      ok: false,
      error: 'errors.network',
      status: 0,
    });
  });

  it('does not invalidate caches when the mutation failed', async () => {
    stubFetch(async () =>
      Response.json(
        { ok: false, error: 'errors.forbidden' },
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);

    await actionRequest('/api/groups/g1/members', { method: 'POST' }, groupQueryKeys('g1'));

    expect(invalidate).not.toHaveBeenCalled();
  });
});
