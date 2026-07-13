import { actionRequest } from '@/spa/api';

export type CredentialKind = 'passkey' | 'password';

export async function renameCredentialAction(
  kind: CredentialKind,
  credentialId: string,
  label: string,
) {
  return actionRequest(`/api/auth/credentials/${kind}/${encodeURIComponent(credentialId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ label }),
  });
}

export async function deletePasskeyAction(credentialId: string): Promise<{ ok: boolean }> {
  return actionRequest(`/api/auth/passkeys/${encodeURIComponent(credentialId)}`, {
    method: 'DELETE',
  });
}
