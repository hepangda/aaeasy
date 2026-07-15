import { actionRequest } from '@/spa/api';

type LogoutResult = {
  ok: boolean;
  error?: string;
  redirectTo?: string;
};

export async function logoutAction(): Promise<void> {
  const result = await actionRequest<LogoutResult>('/api/auth/logout', { method: 'POST' });
  if (result.ok) window.location.assign(result.redirectTo ?? '/');
}
