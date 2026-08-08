import {
  KEYFORGE_ALIAS_MAX_LENGTH,
  KEYFORGE_ALIAS_MIN_LENGTH,
  KEYFORGE_ALIAS_PATTERN,
} from '@aaeasy/contracts';
import { users } from '@aaeasy/db/schema';
import { asc, isNotNull, and, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppEnv } from '../app-env';
import { requireUser } from '../auth/session';
import { rateLimit } from '../lib/rate-limit';

export const userRoutes = new Hono<AppEnv>();

const SEARCH_LIMIT = 10;

/**
 * Look up people to invite, by alias prefix.
 *
 * Two deliberate constraints. It is rate limited per user, because this is the
 * one endpoint that reads across the whole user table and an unthrottled
 * caller could walk the directory. And it matches on a *prefix* rather than a
 * substring: `like '%q%'` cannot use an index and turns every keystroke into a
 * sequential scan, while `lower(username) like 'q%'` rides
 * `users_username_lower_pattern_idx`. You look someone up by the start of the
 * alias you were given, not by an arbitrary fragment of it.
 */
userRoutes.get('/users/search', async (c) => {
  const session = await requireUser(c);
  const allowed = await rateLimit(c, `users:search:${session.user.id}`, {
    windowMs: 60_000,
    max: 30,
  });
  if (!allowed) return c.json({ error: 'RATE_LIMITED', users: [] }, 429);

  const query = c.req.query('q')?.trim().toLowerCase() ?? '';
  if (
    query.length < KEYFORGE_ALIAS_MIN_LENGTH ||
    query.length > KEYFORGE_ALIAS_MAX_LENGTH ||
    !KEYFORGE_ALIAS_PATTERN.test(query)
  ) {
    return c.json({ users: [] });
  }

  const rows = await c.var.db
    .select({ id: users.id, username: users.username, displayName: users.displayName })
    .from(users)
    .where(and(isNotNull(users.username), sql`lower(${users.username}) like ${`${query}%`}`))
    .orderBy(asc(users.username))
    .limit(SEARCH_LIMIT);
  return c.json({ users: rows });
});
