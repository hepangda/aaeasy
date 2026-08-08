import { actionRequest, type ActionResult } from '@/spa/api';

export type LogoutState = ActionResult & { redirectTo?: string };

/**
 * Ends the server session and reports where to go next.
 *
 * The caller performs a full document load rather than a client-side
 * navigation: signing out should leave none of the previous user's data in the
 * query cache.
 */
export async function logoutAction(): Promise<LogoutState> {
  const result = await actionRequest<LogoutState>('/api/auth/logout', { method: 'POST' });
  return result.ok ? { ...result, redirectTo: '/' } : result;
}
