import { headers } from 'next/headers';

/**
 * Best-effort client IP extraction. Returns 'anon' if nothing usable,
 * which means rate limiting will fall back to a global bucket per route —
 * fine for self-hosted scale.
 */
export async function getClientIp(): Promise<string> {
  const hdrs = await headers();
  const xff = hdrs.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim();
  return hdrs.get('x-real-ip')?.trim() || 'anon';
}
