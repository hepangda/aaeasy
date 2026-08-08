import { afterEach, describe, expect, it, vi } from 'vitest';

const { actionRequest } = vi.hoisted(() => ({ actionRequest: vi.fn() }));

vi.mock('@/spa/api', () => ({ actionRequest }));

import { logoutAction } from './auth';

describe('logoutAction', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('reports the project home page as the destination after a successful logout', async () => {
    // Not the provider's `redirectTo`: signing out of AAEasy should land on
    // AAEasy. The caller performs the navigation.
    actionRequest.mockResolvedValue({ ok: true, redirectTo: '/login' });

    await expect(logoutAction()).resolves.toEqual({ ok: true, redirectTo: '/' });
    expect(actionRequest).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST' });
  });

  it('offers no destination when the logout failed', async () => {
    actionRequest.mockResolvedValue({ ok: false, error: 'errors.network', status: 0 });

    await expect(logoutAction()).resolves.toEqual({
      ok: false,
      error: 'errors.network',
      status: 0,
    });
  });
});
