import {
  KEYFORGE_ALIAS_MAX_LENGTH,
  KEYFORGE_ALIAS_MIN_LENGTH,
  KEYFORGE_ALIAS_PATTERN,
} from '@aaeasy/contracts/identity';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { z } from 'zod';
import { ApiError } from '../lib/errors';
import { generateToken } from '../lib/crypto';

const FLOW_TTL_MS = 10 * 60 * 1000;
const TOKEN_EXPIRY_SKEW_MS = 30 * 1000;
const OIDC_SCOPES = 'openid profile email offline_access';
const SEALED_VALUE_VERSION = 'v1';
const SEAL_AAD = new TextEncoder().encode('aaeasy:oidc:v1');

const discoverySchema = z.object({
  issuer: z.url(),
  authorization_endpoint: z.url(),
  token_endpoint: z.url(),
  userinfo_endpoint: z.url(),
  jwks_uri: z.url(),
  revocation_endpoint: z.url(),
  introspection_endpoint: z.url(),
  end_session_endpoint: z.url(),
});

const introspectionResponseSchema = z.discriminatedUnion('active', [
  z.object({ active: z.literal(false) }),
  z.object({
    active: z.literal(true),
    sub: z.string().min(1),
    client_id: z.string().min(1),
    aud: z.string().min(1),
    token_type: z.literal('refresh_token'),
  }),
]);

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.literal('Bearer'),
  expires_in: z.number().int().positive(),
  id_token: z.string().min(1),
  refresh_token: z.string().min(1),
  scope: z.string().min(1),
});

const userInfoSchema = z.object({
  sub: z.string().min(1),
  preferred_username: z
    .string()
    .min(KEYFORGE_ALIAS_MIN_LENGTH)
    .max(KEYFORGE_ALIAS_MAX_LENGTH)
    .regex(KEYFORGE_ALIAS_PATTERN),
  // A malformed address is dropped rather than fatal. `email` is optional
  // here and nullable in the database, and it is only ever used as a
  // display-name fallback — so rejecting the whole login for a bad value while
  // happily accepting a missing one would be inconsistent. Locally seeded
  // KeyForge accounts routinely carry non-RFC emails like `admin`.
  email: z
    .string()
    .optional()
    .transform((value) => (value && z.email().safeParse(value).success ? value : undefined)),
  name: z.string().min(1).optional(),
  picture: z.url().optional(),
  groups: z.array(z.string()).optional(),
});

const flowSchema = z.object({
  state: z.string().min(1),
  nonce: z.string().min(1),
  verifier: z.string().min(43).max(128),
  next: z.string().nullable(),
  expiresAt: z.number().int().positive(),
});

const storedTokensSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  idToken: z.string().min(1),
  accessTokenExpiresAt: z.number().int().positive(),
});

export type OidcProfile = z.infer<typeof userInfoSchema>;
export type StoredOidcTokens = z.infer<typeof storedTokensSchema>;

export type OidcConfig = {
  issuer: string;
  clientId: string;
  clientSecret: string;
  resource: string;
  appUrl: string;
  redirectUri: string;
  postLogoutRedirectUri: string;
};

export type OidcEnv = {
  APP_URL: string;
  OIDC_ISSUER: string;
  OIDC_CLIENT_ID: string;
  OIDC_CLIENT_SECRET?: string;
  OIDC_RESOURCE: string;
  OIDC_SESSION_SECRET?: string;
  ENVIRONMENT?: string;
};

type Discovery = z.infer<typeof discoverySchema>;

export class OidcSessionInvalidError extends Error {
  constructor() {
    super('OIDC_SESSION_INVALID');
    this.name = 'OidcSessionInvalidError';
  }
}

function normalizedOrigin(value: string, variable: string, allowLoopback = false): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ApiError('OIDC_NOT_CONFIGURED', 503, `${variable} must be an absolute URL`);
  }
  if (url.username || url.password || url.hash || url.search || url.pathname !== '/') {
    throw new ApiError('OIDC_NOT_CONFIGURED', 503, `${variable} must contain only an origin`);
  }
  const loopbackHttp = allowLoopback && isLoopbackOrigin(url.origin);
  if (url.protocol !== 'https:' && !loopbackHttp) {
    throw new ApiError('OIDC_NOT_CONFIGURED', 503, `${variable} must use HTTPS`);
  }
  return url.origin;
}

const APPROVED_ISSUERS = ['https://auth.pangda.app', 'https://auth-staging.pangda.app'];

/**
 * Whether a loopback OIDC issuer is acceptable.
 *
 * The issuer allowlist is a security control: it stops a compromised or
 * mistyped variable from redirecting users to an attacker-controlled login
 * page. Local development needs to point at a KeyForge instance on
 * `http://localhost:17001`, so the allowlist is widened — but only when the
 * deployment explicitly is not production, and only for loopback hosts. A
 * production Worker can still never be pointed anywhere but Pangda Auth.
 */
function allowsLoopbackIssuer(env: OidcEnv): boolean {
  return (env.ENVIRONMENT ?? 'production') !== 'production';
}

function isLoopbackOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (
      url.protocol === 'http:' &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]')
    );
  } catch {
    return false;
  }
}

export function oidcConfig(env: OidcEnv): OidcConfig {
  const devLoopback = allowsLoopbackIssuer(env);
  const issuer = normalizedOrigin(env.OIDC_ISSUER, 'OIDC_ISSUER', devLoopback);
  const issuerApproved =
    APPROVED_ISSUERS.includes(issuer) || (devLoopback && isLoopbackOrigin(issuer));
  if (!issuerApproved) {
    throw new ApiError('OIDC_NOT_CONFIGURED', 503, 'OIDC_ISSUER is not an approved login source');
  }
  const appUrl = normalizedOrigin(env.APP_URL, 'APP_URL', devLoopback);
  const clientId = env.OIDC_CLIENT_ID.trim();
  const clientSecret = env.OIDC_CLIENT_SECRET?.trim() ?? '';
  if (!clientId || !clientSecret) {
    throw new ApiError('OIDC_NOT_CONFIGURED', 503, 'OIDC client credentials are missing');
  }
  let resource: string;
  try {
    const resourceUrl = new URL(env.OIDC_RESOURCE);
    if (
      resourceUrl.protocol !== 'https:' ||
      resourceUrl.username ||
      resourceUrl.password ||
      resourceUrl.search ||
      resourceUrl.hash
    ) {
      throw new Error('invalid resource URL');
    }
    resource = resourceUrl.toString().replace(/\/$/u, '');
  } catch {
    throw new ApiError('OIDC_NOT_CONFIGURED', 503, 'OIDC_RESOURCE must be an absolute URL');
  }
  return {
    issuer,
    clientId,
    clientSecret,
    resource,
    appUrl,
    redirectUri: `${appUrl}/api/auth/callback`,
    postLogoutRedirectUri: `${appUrl}/`,
  };
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error('INVALID_BASE64URL');
  const padded = value
    .replaceAll('-', '+')
    .replaceAll('_', '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function ownedBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

async function encryptionKey(secret: string | undefined): Promise<CryptoKey> {
  if (!secret) throw new ApiError('OIDC_NOT_CONFIGURED', 503, 'OIDC_SESSION_SECRET is missing');
  let bytes: Uint8Array;
  try {
    bytes = base64UrlToBytes(secret);
  } catch {
    throw new ApiError('OIDC_NOT_CONFIGURED', 503, 'OIDC_SESSION_SECRET is invalid');
  }
  if (bytes.byteLength !== 32) {
    throw new ApiError('OIDC_NOT_CONFIGURED', 503, 'OIDC_SESSION_SECRET must contain 32 bytes');
  }
  return crypto.subtle.importKey('raw', ownedBuffer(bytes), 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
}

export async function sealOidcValue(value: unknown, secret: string | undefined): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: SEAL_AAD },
    await encryptionKey(secret),
    plaintext,
  );
  return `${SEALED_VALUE_VERSION}.${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(ciphertext))}`;
}

export async function unsealOidcValue(value: string, secret: string | undefined): Promise<unknown> {
  const [version, encodedIv, encodedCiphertext, extra] = value.split('.');
  if (version !== SEALED_VALUE_VERSION || !encodedIv || !encodedCiphertext || extra !== undefined) {
    throw new Error('INVALID_SEALED_VALUE');
  }
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: ownedBuffer(base64UrlToBytes(encodedIv)),
      additionalData: SEAL_AAD,
    },
    await encryptionKey(secret),
    ownedBuffer(base64UrlToBytes(encodedCiphertext)),
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as unknown;
}

export async function sealStoredTokens(
  tokens: StoredOidcTokens,
  secret: string | undefined,
): Promise<string> {
  return sealOidcValue(storedTokensSchema.parse(tokens), secret);
}

export async function unsealStoredTokens(
  value: string,
  secret: string | undefined,
): Promise<StoredOidcTokens> {
  return storedTokensSchema.parse(await unsealOidcValue(value, secret));
}

function assertSameIssuerOrigin(metadata: Discovery, issuer: string): void {
  if (metadata.issuer !== issuer) throw new ApiError('OIDC_DISCOVERY_INVALID', 502);
  const expectedOrigin = new URL(issuer).origin;
  for (const endpoint of [
    metadata.authorization_endpoint,
    metadata.token_endpoint,
    metadata.userinfo_endpoint,
    metadata.jwks_uri,
    metadata.revocation_endpoint,
    metadata.introspection_endpoint,
    metadata.end_session_endpoint,
  ]) {
    if (new URL(endpoint).origin !== expectedOrigin) {
      throw new ApiError('OIDC_DISCOVERY_INVALID', 502);
    }
  }
}

export async function discoverOidc(env: OidcEnv): Promise<Discovery> {
  const config = oidcConfig(env);
  let response: Response;
  try {
    response = await fetch(`${config.issuer}/.well-known/openid-configuration`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new ApiError('OIDC_UNAVAILABLE', 503);
  }
  if (!response.ok) throw new ApiError('OIDC_UNAVAILABLE', 503);
  const parsed = discoverySchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new ApiError('OIDC_DISCOVERY_INVALID', 502);
  assertSameIssuerOrigin(parsed.data, config.issuer);
  return parsed.data;
}

export function safeReturnPath(value: string | null | undefined): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return null;
  }
  const base = new URL('https://aaeasy.invalid');
  const parsed = new URL(value, base);
  return parsed.origin === base.origin ? `${parsed.pathname}${parsed.search}${parsed.hash}` : null;
}

export async function createAuthorizationRequest(
  env: OidcEnv,
  requestedPath: string | null | undefined,
): Promise<{ authorizationUrl: string; sealedFlow: string }> {
  const config = oidcConfig(env);
  const metadata = await discoverOidc(env);
  const verifier = generateToken(32);
  const state = generateToken(24);
  const nonce = generateToken(24);
  const challenge = bytesToBase64Url(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))),
  );
  const authorizationUrl = new URL(metadata.authorization_endpoint);
  const params = {
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: OIDC_SCOPES,
    resource: config.resource,
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  };
  for (const [key, value] of Object.entries(params)) authorizationUrl.searchParams.set(key, value);
  const sealedFlow = await sealOidcValue(
    {
      state,
      nonce,
      verifier,
      next: safeReturnPath(requestedPath),
      expiresAt: Date.now() + FLOW_TTL_MS,
    },
    env.OIDC_SESSION_SECRET,
  );
  return { authorizationUrl: authorizationUrl.toString(), sealedFlow };
}

function clientAuthorization(config: OidcConfig): string {
  return `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`;
}

async function exchangeToken(
  env: OidcEnv,
  metadata: Discovery,
  body: URLSearchParams,
  invalidSessionOnFailure: boolean,
): Promise<StoredOidcTokens> {
  const config = oidcConfig(env);
  let response: Response;
  try {
    response = await fetch(metadata.token_endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: clientAuthorization(config),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new ApiError('OIDC_UNAVAILABLE', 503);
  }
  if (!response.ok) {
    if (invalidSessionOnFailure && response.status >= 400 && response.status < 500) {
      throw new OidcSessionInvalidError();
    }
    throw new ApiError('OIDC_TOKEN_EXCHANGE_FAILED', 502);
  }
  const parsed = tokenResponseSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new ApiError('OIDC_TOKEN_RESPONSE_INVALID', 502);
  return {
    accessToken: parsed.data.access_token,
    refreshToken: parsed.data.refresh_token,
    idToken: parsed.data.id_token,
    accessTokenExpiresAt: Date.now() + parsed.data.expires_in * 1000,
  };
}

async function verifyIdToken(
  metadata: Discovery,
  config: OidcConfig,
  idToken: string,
  nonce?: string,
): Promise<string> {
  let payload: Awaited<ReturnType<typeof jwtVerify>>['payload'];
  try {
    ({ payload } = await jwtVerify(
      idToken,
      createRemoteJWKSet(new URL(metadata.jwks_uri), { timeoutDuration: 8_000 }),
      {
        algorithms: ['RS256'],
        issuer: metadata.issuer,
        audience: config.clientId,
        typ: 'JWT',
      },
    ));
  } catch {
    throw new ApiError('OIDC_ID_TOKEN_INVALID', 502);
  }
  if (typeof payload.sub !== 'string' || !payload.sub) {
    throw new ApiError('OIDC_ID_TOKEN_INVALID', 502);
  }
  if (nonce !== undefined && payload.nonce !== nonce) {
    throw new ApiError('OIDC_ID_TOKEN_INVALID', 502);
  }
  return payload.sub;
}

export async function fetchOidcProfile(env: OidcEnv, accessToken: string): Promise<OidcProfile> {
  const metadata = await discoverOidc(env);
  let response: Response;
  try {
    response = await fetch(metadata.userinfo_endpoint, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new ApiError('OIDC_UNAVAILABLE', 503);
  }
  if (response.status === 401 || response.status === 403) throw new OidcSessionInvalidError();
  if (!response.ok) throw new ApiError('OIDC_UNAVAILABLE', 503);
  return parseOidcProfile(await response.json().catch(() => null));
}

export function parseOidcProfile(value: unknown): OidcProfile {
  const parsed = userInfoSchema.safeParse(value);
  if (!parsed.success) throw new ApiError('OIDC_USERINFO_INVALID', 502);
  return parsed.data;
}

export async function completeAuthorization(
  env: OidcEnv,
  sealedFlow: string,
  query: URLSearchParams,
): Promise<{ profile: OidcProfile; tokens: StoredOidcTokens; next: string | null }> {
  let flow: z.infer<typeof flowSchema>;
  try {
    flow = flowSchema.parse(await unsealOidcValue(sealedFlow, env.OIDC_SESSION_SECRET));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('OIDC_FLOW_INVALID', 400);
  }
  if (flow.expiresAt <= Date.now() || query.get('state') !== flow.state) {
    throw new ApiError('OIDC_FLOW_INVALID', 400);
  }
  const providerError = query.get('error');
  if (providerError) throw new ApiError('OIDC_AUTHORIZATION_DENIED', 401, providerError);
  const code = query.get('code');
  if (!code) throw new ApiError('OIDC_FLOW_INVALID', 400);

  const config = oidcConfig(env);
  const metadata = await discoverOidc(env);
  const tokens = await exchangeToken(
    env,
    metadata,
    new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.redirectUri,
      code_verifier: flow.verifier,
    }),
    false,
  );
  const subject = await verifyIdToken(metadata, config, tokens.idToken, flow.nonce);
  const profile = await fetchOidcProfile(env, tokens.accessToken);
  if (profile.sub !== subject) throw new ApiError('OIDC_USERINFO_INVALID', 502);
  return { profile, tokens, next: flow.next };
}

export function oidcAccessTokenNeedsRefresh(tokens: StoredOidcTokens): boolean {
  return tokens.accessTokenExpiresAt <= Date.now() + TOKEN_EXPIRY_SKEW_MS;
}

export async function refreshOidcTokens(
  env: OidcEnv,
  tokens: StoredOidcTokens,
): Promise<StoredOidcTokens> {
  const metadata = await discoverOidc(env);
  return exchangeToken(
    env,
    metadata,
    new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken }),
    true,
  );
}

export type OidcSessionCheck = 'active' | 'inactive' | 'unsupported' | 'unavailable';

/**
 * Checks the refresh-token family because KeyForge revokes it immediately when
 * the originating browser session signs out. Access tokens are self-contained
 * JWTs and can otherwise remain valid for several minutes after that logout.
 */
export async function checkOidcSession(
  env: OidcEnv,
  refreshToken: string,
  expectedSubject: string,
): Promise<OidcSessionCheck> {
  const config = oidcConfig(env);
  let metadata: Discovery;
  try {
    metadata = await discoverOidc(env);
  } catch (error) {
    if (error instanceof ApiError && error.code === 'OIDC_UNAVAILABLE') return 'unavailable';
    throw error;
  }

  let response: Response;
  try {
    response = await fetch(metadata.introspection_endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: clientAuthorization(config),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ token: refreshToken }),
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    return 'unavailable';
  }

  // Older KeyForge deployments restricted introspection to resource services.
  // Keep a rolling deployment fail-open while the authorization server is
  // upgraded; other authentication failures still surface as configuration errors.
  if (response.status === 403) return 'unsupported';
  if (response.status === 429 || response.status >= 500) return 'unavailable';
  if (!response.ok) throw new ApiError('OIDC_INTROSPECTION_FAILED', 502);

  const parsed = introspectionResponseSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new ApiError('OIDC_INTROSPECTION_RESPONSE_INVALID', 502);
  if (!parsed.data.active) return 'inactive';
  return parsed.data.sub === expectedSubject &&
    parsed.data.client_id === config.clientId &&
    parsed.data.aud === config.resource
    ? 'active'
    : 'inactive';
}

export function buildOidcLogoutUrl(env: OidcEnv, idToken?: string): string {
  const config = oidcConfig(env);
  const url = new URL('/oauth/end_session', config.issuer);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('post_logout_redirect_uri', config.postLogoutRedirectUri);
  if (idToken) url.searchParams.set('id_token_hint', idToken);
  return url.toString();
}

export async function revokeOidcRefreshToken(env: OidcEnv, refreshToken: string): Promise<void> {
  const config = oidcConfig(env);
  const metadata = await discoverOidc(env);
  const response = await fetch(metadata.revocation_endpoint, {
    method: 'POST',
    headers: {
      Authorization: clientAuthorization(config),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ token: refreshToken }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`OIDC_REVOCATION_FAILED_${response.status}`);
}
