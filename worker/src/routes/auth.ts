import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AppEnv } from '../app-env';
import { claimPendingShareLink } from '../auth/claim';
import {
  buildOidcLogoutUrl,
  completeAuthorization,
  createAuthorizationRequest,
  oidcConfig,
  safeReturnPath,
  revokeOidcRefreshToken,
} from '../auth/oidc';
import {
  createSession,
  destroyCurrentSession,
  getCurrentSession,
  requireUser,
} from '../auth/session';
import { ApiError } from '../lib/errors';
import { isSecureRequest } from '../lib/request';

const OIDC_FLOW_COOKIE = 'aaeasy_oidc_flow';
const FLOW_COOKIE_MAX_AGE_SECONDS = 10 * 60;

export const authRoutes = new Hono<AppEnv>();

authRoutes.get('/session', async (c) => {
  const session = await getCurrentSession(c);
  return c.json({ user: session?.user ?? null });
});

authRoutes.get('/auth/login', async (c) => {
  const next = safeReturnPath(c.req.query('next'));
  const session = await getCurrentSession(c);
  if (session) return c.redirect(next ?? '/');

  const request = await createAuthorizationRequest(c.env, next);
  setCookie(c, OIDC_FLOW_COOKIE, request.sealedFlow, {
    path: '/',
    httpOnly: true,
    maxAge: FLOW_COOKIE_MAX_AGE_SECONDS,
    sameSite: 'Lax',
    secure: isSecureRequest(c),
  });
  return c.redirect(request.authorizationUrl);
});

authRoutes.get('/auth/callback', async (c) => {
  const sealedFlow = getCookie(c, OIDC_FLOW_COOKIE);
  deleteCookie(c, OIDC_FLOW_COOKIE, { path: '/' });
  if (!sealedFlow) throw new ApiError('OIDC_FLOW_INVALID', 400);

  try {
    const result = await completeAuthorization(c.env, sealedFlow, new URL(c.req.url).searchParams);
    await createSession(c, result.profile, result.tokens);
    const claimedGroupId = await claimPendingShareLink(c, result.profile.sub);
    return c.redirect(claimedGroupId ? `/groups/${claimedGroupId}` : (result.next ?? '/'));
  } catch (error) {
    if (error instanceof ApiError && error.code === 'OIDC_AUTHORIZATION_DENIED') {
      return c.redirect('/?auth_error=access_denied');
    }
    throw error;
  }
});

authRoutes.get('/auth/account', async (c) => {
  await requireUser(c);
  return c.redirect(`${oidcConfig(c.env).issuer}/`);
});

authRoutes.post('/auth/logout', async (c) => {
  const tokens = await destroyCurrentSession(c);
  if (tokens) {
    c.executionCtx.waitUntil(
      revokeOidcRefreshToken(c.env, tokens.refreshToken).catch((error) =>
        console.error(
          JSON.stringify({
            message: 'OIDC refresh-token revocation failed',
            error: error instanceof Error ? error.message : String(error),
          }),
        ),
      ),
    );
  }
  return c.json({
    ok: true,
    redirectTo: buildOidcLogoutUrl(c.env, tokens?.idToken),
  });
});
