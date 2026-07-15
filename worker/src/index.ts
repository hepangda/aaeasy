import { createDatabase } from '@aaeasy/db';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { csrf } from 'hono/csrf';
import type { AppEnv } from './app-env';
import { handleApiError } from './lib/errors';
import { apiSecureHeaders } from './middleware/secure-headers';
import { accountRoutes } from './routes/account';
import { aiRoutes } from './routes/ai';
import { authRoutes } from './routes/auth';
import { expenseRoutes } from './routes/expenses';
import { exportRoutes } from './routes/export';
import { groupRoutes } from './routes/groups';
import { realtimeRoutes } from './routes/realtime';
import { receiptRoutes } from './routes/receipts';
import { settlementRoutes } from './routes/settlements';

export { GroupRoom } from './durable-objects/group-room';
export { RateLimiter } from './durable-objects/rate-limiter';

const app = new Hono<AppEnv>();

app.use('/api/*', apiSecureHeaders());
app.use('/api/*', csrf());
app.use('/api/*', async (c, next) => {
  c.set('db', createDatabase(c.env.HYPERDRIVE.connectionString));
  await next();
});

app.get('/api/health', async (c) => {
  await c.var.db.execute(sql`select 1`);
  const room = c.env.GROUP_ROOMS.getByName('__health__');
  const durableObject = await room.health();

  return c.json({
    ok: true,
    runtime: 'cloudflare-workers',
    framework: 'hono',
    database: { ok: true },
    durableObject,
  });
});

app.route('/api', accountRoutes);
app.route('/api', aiRoutes);
app.route('/api', authRoutes);
app.route('/api', expenseRoutes);
app.route('/api', exportRoutes);
app.route('/api', groupRoutes);
app.route('/api', realtimeRoutes);
app.route('/api', receiptRoutes);
app.route('/api', settlementRoutes);

app.notFound((c) => c.json({ error: 'NOT_FOUND' }, 404));
app.onError(handleApiError);

export default app;
