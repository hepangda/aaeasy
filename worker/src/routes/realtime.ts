import { groups } from '@aaeasy/db/schema';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppEnv } from '../app-env';
import { requireGroupAccess } from '../auth/access';
import { ApiError } from '../lib/errors';

export const realtimeRoutes = new Hono<AppEnv>();

realtimeRoutes.get('/groups/:groupId/realtime', async (c) => {
  const groupId = c.req.param('groupId');
  await requireGroupAccess(c, groupId, 'READ_GROUP');
  const [group] = await c.var.db
    .select({ revision: groups.revision })
    .from(groups)
    .where(eq(groups.id, groupId))
    .limit(1);
  if (!group) throw new ApiError('NOT_FOUND', 404);

  const headers = new Headers({ Upgrade: 'websocket' });
  headers.set('x-aaeasy-revision', group.revision.toString());
  return c.env.GROUP_ROOMS.getByName(groupId).fetch(
    new Request(c.req.url, { method: 'GET', headers }),
  );
});
