import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkOidcSession,
  type OidcEnv,
  oidcConfig,
  parseOidcProfile,
  safeReturnPath,
  sealStoredTokens,
  unsealStoredTokens,
} from './oidc';

const SESSION_SECRET = 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc';

const discoveryDocument = {
  issuer: 'https://auth-staging.pangda.app',
  authorization_endpoint: 'https://auth-staging.pangda.app/oauth/authorize',
  token_endpoint: 'https://auth-staging.pangda.app/oauth/token',
  userinfo_endpoint: 'https://auth-staging.pangda.app/oauth/userinfo',
  jwks_uri: 'https://auth-staging.pangda.app/.well-known/jwks.json',
  revocation_endpoint: 'https://auth-staging.pangda.app/oauth/revoke',
  introspection_endpoint: 'https://auth-staging.pangda.app/oauth/introspect',
  end_session_endpoint: 'https://auth-staging.pangda.app/oauth/end_session',
};

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

afterEach(() => vi.unstubAllGlobals());

function stubIntrospection(body: unknown, status = 200) {
  const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (url.endsWith('/.well-known/openid-configuration')) {
      return Response.json(discoveryDocument);
    }
    return Response.json(body, { status });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
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

describe('checkOidcSession', () => {
  it('recognizes an active refresh-token family owned by this client and subject', async () => {
    const fetchMock = stubIntrospection({
      active: true,
      sub: 'user-id',
      client_id: 'aaeasy',
      aud: 'https://aaeasy.pangda.app',
      token_type: 'refresh_token',
    });

    await expect(checkOidcSession(env(), 'refresh-token', 'user-id')).resolves.toBe('active');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, introspectionInit] = fetchMock.mock.calls[1] ?? [];
    expect(introspectionInit?.headers).toMatchObject({
      Authorization: `Basic ${btoa('aaeasy:client-secret')}`,
    });
    expect(new URLSearchParams(String(introspectionInit?.body)).get('token')).toBe('refresh-token');
  });

  it.each([
    [{ active: false }, 'inactive'],
    [
      {
        active: true,
        sub: 'another-user',
        client_id: 'aaeasy',
        aud: 'https://aaeasy.pangda.app',
        token_type: 'refresh_token',
      },
      'inactive',
    ],
  ] as const)('treats a revoked or mismatched token as %s', async (body, expected) => {
    stubIntrospection(body);
    await expect(checkOidcSession(env(), 'refresh-token', 'user-id')).resolves.toBe(expected);
  });

  it('supports rolling deployment from a KeyForge version that rejects application clients', async () => {
    stubIntrospection({ error: 'invalid_client' }, 403);
    await expect(checkOidcSession(env(), 'refresh-token', 'user-id')).resolves.toBe('unsupported');
  });

  it('does not log users out when KeyForge is temporarily unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unavailable')));
    await expect(checkOidcSession(env(), 'refresh-token', 'user-id')).resolves.toBe('unavailable');
  });
});

describe('parseOidcProfile', () => {
  it('uses the KeyForge preferred_username claim as the account alias', () => {
    expect(
      parseOidcProfile({
        sub: 'user-id',
        preferred_username: 'Pangda42',
        email: 'user@pangda.app',
      }),
    ).toMatchObject({ sub: 'user-id', preferred_username: 'Pangda42' });
  });

  it.each([
    { sub: 'user-id' },
    { sub: 'user-id', preferred_username: 'not-valid' },
    { sub: 'user-id', preferred_username: 'a'.repeat(65) },
  ])('rejects a UserInfo response without a valid KeyForge alias', (profile) => {
    expect(() => parseOidcProfile(profile)).toThrow('OIDC_USERINFO_INVALID');
  });
});
