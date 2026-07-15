import { describe, expect, it } from 'vitest';
import {
  type OidcEnv,
  oidcConfig,
  safeReturnPath,
  sealStoredTokens,
  unsealStoredTokens,
} from './oidc';

const SESSION_SECRET = 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc';

function env(overrides: Partial<OidcEnv> = {}): OidcEnv {
  return {
    APP_URL: 'http://localhost:5173',
    OIDC_ISSUER: 'https://auth-staging.pangda.app',
    OIDC_CLIENT_ID: 'aaeasy',
    OIDC_CLIENT_SECRET: 'client-secret',
    OIDC_RESOURCE: 'https://aaeasy.pangda.app',
    OIDC_SESSION_SECRET: SESSION_SECRET,
    ...overrides,
  };
}

describe('safeReturnPath', () => {
  it('keeps internal paths including query and hash', () => {
    expect(safeReturnPath('/groups/ledger?tab=summary#balance')).toBe(
      '/groups/ledger?tab=summary#balance',
    );
  });

  it.each(['https://evil.example', '//evil.example/path', '/\\evil.example/path', null])(
    'rejects unsafe return path %s',
    (value) => expect(safeReturnPath(value)).toBeNull(),
  );
});

describe('OIDC token sealing', () => {
  const tokens = {
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    idToken: 'id-token',
    accessTokenExpiresAt: 2_000_000_000_000,
  };

  it('round trips the server-side token set', async () => {
    const sealed = await sealStoredTokens(tokens, SESSION_SECRET);
    expect(sealed).not.toContain(tokens.refreshToken);
    await expect(unsealStoredTokens(sealed, SESSION_SECRET)).resolves.toEqual(tokens);
  });

  it('rejects a modified ciphertext', async () => {
    const sealed = await sealStoredTokens(tokens, SESSION_SECRET);
    const tampered = `${sealed.slice(0, -1)}${sealed.endsWith('A') ? 'B' : 'A'}`;
    await expect(unsealStoredTokens(tampered, SESSION_SECRET)).rejects.toThrow();
  });
});

describe('oidcConfig', () => {
  it('uses the staging issuer for local development', () => {
    expect(oidcConfig(env())).toMatchObject({
      issuer: 'https://auth-staging.pangda.app',
      redirectUri: 'http://localhost:5173/api/auth/callback',
      postLogoutRedirectUri: 'http://localhost:5173/',
    });
  });

  it('rejects every issuer outside the two approved Pangda Auth environments', () => {
    expect(() => oidcConfig(env({ OIDC_ISSUER: 'https://login.example.com' }))).toThrow(
      'OIDC_NOT_CONFIGURED',
    );
  });
});
