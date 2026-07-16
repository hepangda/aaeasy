import { afterEach, describe, expect, it, vi } from 'vitest';

const { actionRequest } = vi.hoisted(() => ({ actionRequest: vi.fn() }));

vi.mock('@/spa/api', () => ({ actionRequest }));

import { logoutAction } from './auth';

describe('logoutAction', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('returns to the project home page after a successful logout', async () => {
    const assign = vi.fn();
    vi.stubGlobal('window', { location: { assign } });
    actionRequest.mockResolvedValue({ ok: true, redirectTo: '/login' });

    await logoutAction();

    expect(actionRequest).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST' });
    expect(assign).toHaveBeenCalledWith('/');
  });
});
