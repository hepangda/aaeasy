import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { apiSecureHeaders } from './secure-headers';

function createApp() {
  const app = new Hono();
  app.use('/api/*', apiSecureHeaders());
  app.get('/api/health', (c) => c.json({ ok: true }));
  app.get('/api/groups/:groupId/realtime', () => fetch('data:text/plain,realtime'));
  return app;
}

describe('apiSecureHeaders', () => {
  it('adds security headers to regular API responses', async () => {
    const response = await createApp().request('/api/health');

    expect(response.status).toBe(200);
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('does not modify immutable WebSocket proxy response headers', async () => {
    const response = await createApp().request('/api/groups/group-1/realtime');

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('realtime');
    expect(response.headers.get('X-Content-Type-Options')).toBeNull();
  });
});
