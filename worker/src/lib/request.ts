import type { Context } from 'hono';
import type { AppEnv } from '../app-env';

export function getClientIp(c: Context<AppEnv>): string {
  return (
    c.req.header('cf-connecting-ip') ??
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
    c.req.header('x-real-ip')?.trim() ??
    'anon'
  );
}

export function isSecureRequest(c: Context<AppEnv>): boolean {
  return new URL(c.req.url).protocol === 'https:' || new URL(c.env.APP_URL).protocol === 'https:';
}
