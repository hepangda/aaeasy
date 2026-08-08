import type { Context } from 'hono';
import type { AppEnv } from '../app-env';

export interface RateLimitRule {
  windowMs: number;
  max: number;
}

/**
 * Consume one token from a Durable Object window, setting `Retry-After` when
 * the caller is over budget. Returns false instead of throwing so each route
 * can pick its own status and error code.
 */
export async function rateLimit(
  c: Context<AppEnv>,
  key: string,
  rule: RateLimitRule,
): Promise<boolean> {
  const result = await c.env.RATE_LIMITER.getByName(key).consume(rule);
  if (!result.ok) {
    c.header('Retry-After', String(Math.max(1, Math.ceil((result.retryAfterMs ?? 1000) / 1000))));
  }
  return result.ok;
}
