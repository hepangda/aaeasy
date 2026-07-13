import type { AuthState } from '@aaeasy/contracts';
import { actionRequest, formString } from '@/spa/api';

export type { AuthState };

export async function registerAction(_previous: AuthState, formData: FormData): Promise<AuthState> {
  return actionRequest('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      username: formString(formData, 'username'),
      password: formString(formData, 'password'),
    }),
  });
}

export async function registerNoPasswordAction(
  _previous: AuthState,
  formData: FormData,
): Promise<AuthState> {
  return actionRequest('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username: formString(formData, 'username') }),
  });
}

export async function loginAction(_previous: AuthState, formData: FormData): Promise<AuthState> {
  return actionRequest('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      username: formString(formData, 'username'),
      password: formString(formData, 'password'),
    }),
  });
}

export async function logoutAction(): Promise<void> {
  await actionRequest('/api/auth/logout', { method: 'POST' });
  window.location.assign('/');
}

export async function setPasswordAction(
  _previous: AuthState,
  formData: FormData,
): Promise<AuthState> {
  return actionRequest('/api/auth/password', {
    method: 'PUT',
    body: JSON.stringify({
      password: formString(formData, 'password'),
      label: formString(formData, 'label') || undefined,
    }),
  });
}

export async function deletePasswordAction(credentialId: string): Promise<AuthState> {
  return actionRequest(`/api/auth/password/${encodeURIComponent(credentialId)}`, {
    method: 'DELETE',
  });
}
