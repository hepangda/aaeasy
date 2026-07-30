/**
 * One-shot local auth setup.
 *
 * Registers the `aaeasy` OAuth client (and its API resource, if missing) on a
 * KeyForge instance running at http://localhost:17001, then writes the
 * one-time client secret into `.dev.vars`.
 *
 *   pnpm auth:setup
 *
 * KeyForge exposes no REST admin API, so this drives the same form-post
 * endpoints its admin console uses: a session cookie from POST /login, then
 * POST /console/resources and POST /console/clients, each carrying the CSRF
 * token scraped from the corresponding GET. Because that couples us to
 * server-rendered markup, the script reads the client back afterwards and
 * checks the fields that actually break login, rather than trusting a 200.
 *
 * Safe to re-run. An existing client is kept and its secret rotated, which
 * preserves the client's grants — KeyForge only ever reveals a secret at
 * creation or rotation time, so there is no way to just read the current one.
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const ISSUER = (process.env.KEYFORGE_URL ?? 'http://localhost:17001').replace(/\/$/u, '');
const USERNAME = process.env.KEYFORGE_USER ?? 'admin';
const PASSWORD = process.env.KEYFORGE_PASSWORD ?? 'admin';
const APP_URL = (process.env.APP_URL ?? 'http://localhost:5173').replace(/\/$/u, '');

const CLIENT_ID = 'aaeasy';
const RESOURCE = 'https://aaeasy.pangda.app';
const SCOPES = ['openid', 'profile', 'email', 'groups', 'offline_access'];

const cookies = new Map<string, string>();

function cookieHeader(): string {
  return [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
}

function storeCookies(response: Response): void {
  for (const raw of response.headers.getSetCookie()) {
    const pair = raw.split(';')[0] ?? '';
    const separator = pair.indexOf('=');
    if (separator > 0) cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
}

/** Follows redirects by hand so cookies are captured at every hop. */
async function request(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(`${ISSUER}${path}`, {
    ...init,
    redirect: 'manual',
    headers: { ...init?.headers, cookie: cookieHeader() },
  });
  storeCookies(response);
  const location = response.headers.get('location');
  if (response.status >= 300 && response.status < 400 && location) {
    const next = new URL(location, ISSUER);
    return request(`${next.pathname}${next.search}`);
  }
  return response;
}

async function getText(path: string): Promise<string> {
  const response = await request(path);
  if (!response.ok) fail(`GET ${path} returned ${response.status}`);
  return response.text();
}

/** KeyForge renders one CSRF token per page. */
function csrfFrom(html: string, path: string): string {
  const match = /name="csrf_token"[^>]*value="([^"]+)"/u.exec(html);
  if (!match?.[1]) fail(`no CSRF token on ${path} — is this really KeyForge?`);
  return match[1];
}

async function post(path: string, fields: Array<[string, string]>): Promise<Response> {
  const body = new URLSearchParams();
  body.set('csrf_token', csrfFrom(await getText(path), path));
  for (const [name, value] of fields) body.append(name, value);
  return request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
}

function fail(message: string): never {
  console.error(`\n  ✖ ${message}\n`);
  process.exit(1);
}

function step(message: string): void {
  console.log(`  → ${message}`);
}

/** The secret is shown once, in `<div class="secret">`. */
function secretFrom(html: string): string | null {
  return /<div class="secret">([^<]+)<\/div>/u.exec(html)?.[1]?.trim() ?? null;
}

function upsert(source: string, key: string, value: string): string {
  const line = `${key}="${value}"`;
  const pattern = new RegExp(`^${key}=.*$`, 'mu');
  return pattern.test(source) ? source.replace(pattern, line) : `${source.trimEnd()}\n${line}\n`;
}

async function assertReachable(): Promise<void> {
  let discovery: Response;
  try {
    discovery = await fetch(`${ISSUER}/.well-known/openid-configuration`);
  } catch {
    fail(`cannot reach ${ISSUER} — start KeyForge first`);
  }
  if (!discovery.ok) fail(`${ISSUER} is up but not serving OIDC discovery`);
  const { issuer } = (await discovery.json()) as { issuer?: string };
  if (issuer !== ISSUER) fail(`discovery reports issuer ${issuer}, expected ${ISSUER}`);
}

async function signIn(): Promise<void> {
  // The login field accepts a username or an email.
  const response = await post('/login', [
    ['email', USERNAME],
    ['password', PASSWORD],
    ['return_to', '/console'],
  ]);
  // A failed sign-in re-renders the form rather than returning an error status.
  if ((await response.text()).includes('name="password"')) {
    fail(`login failed for "${USERNAME}" — check KEYFORGE_USER / KEYFORGE_PASSWORD`);
  }
}

async function ensureResource(): Promise<void> {
  const resources = await getText('/console/resources');
  if (resources.includes(encodeURIComponent(RESOURCE))) {
    step(`resource ${RESOURCE} already exists`);
    return;
  }
  const created = await post('/console/resources', [
    ['resource_uri', RESOURCE],
    ['name', CLIENT_ID],
    ['allowed_scopes', SCOPES.join('\n')],
  ]);
  if (!created.ok) fail(`creating resource ${RESOURCE} failed (${created.status})`);
  step(`created resource ${RESOURCE}`);
}

/** Returns the one-time client secret, creating or rotating as needed. */
async function ensureClient(): Promise<string> {
  const clients = await getText('/console/clients');
  const exists = clients.includes(`/console/clients/${CLIENT_ID}`);

  if (exists) {
    // Update settings first, so a re-run repairs drifted config too.
    const saved = await post(`/console/clients/${CLIENT_ID}`, clientFields());
    if (!saved.ok) fail(`updating client "${CLIENT_ID}" failed (${saved.status})`);

    const rotatePath = `/console/clients/${CLIENT_ID}/rotate-secret`;
    const rotated = await post(rotatePath, [['confirmation', CLIENT_ID]]);
    const secret = secretFrom(await rotated.text());
    if (!secret) fail('rotated the secret but could not read it from the response');
    step(`updated client "${CLIENT_ID}" and rotated its secret`);
    return secret;
  }

  const created = await post('/console/clients', [['client_id', CLIENT_ID], ...clientFields()]);
  const secret = secretFrom(await created.text());
  if (!secret) fail(`creating client "${CLIENT_ID}" failed (${created.status})`);
  step(`created client "${CLIENT_ID}"`);
  return secret;
}

function clientFields(): Array<[string, string]> {
  return [
    ['name', 'AAEasy'],
    ['client_kind', 'application'],
    ['type', 'confidential'],
    ['redirect_uris', `${APP_URL}/api/auth/callback`],
    ['post_logout_redirect_uris', `${APP_URL}/`],
    ['allowed_scopes', SCOPES.join('\n')],
    ['allowed_grant_types', 'authorization_code\nrefresh_token'],
    ['allowed_resources', RESOURCE],
    ['default_resource', RESOURCE],
  ];
}

/**
 * The form-post API answers 200 for shapes it then stores differently, so
 * confirm the three things whose absence breaks login in a confusing way.
 */
async function verifyClient(): Promise<void> {
  const detail = await getText(`/console/clients/${CLIENT_ID}`);
  const missing = (
    [
      [
        `redirect URI ${APP_URL}/api/auth/callback`,
        detail.includes(`${APP_URL}/api/auth/callback`),
      ],
      [`resource ${RESOURCE}`, detail.includes(RESOURCE)],
      ['groups scope', /name="allowed_scopes"[^>]*>[^<]*\bgroups\b/u.test(detail)],
    ] as Array<[string, boolean]>
  )
    .filter(([, ok]) => !ok)
    .map(([label]) => label);
  if (missing.length > 0) fail(`client saved but missing: ${missing.join(', ')}`);
  step('verified redirect URI, resource and scopes');
}

function writeDevVars(secret: string): void {
  if (!existsSync('.dev.vars')) copyFileSync('.dev.vars.example', '.dev.vars');
  let vars = readFileSync('.dev.vars', 'utf8');
  vars = upsert(vars, 'OIDC_CLIENT_SECRET', secret);
  // Only mint a session secret when there isn't a real one already, so re-runs
  // don't invalidate existing local sessions.
  if (!/^OIDC_SESSION_SECRET="?[A-Za-z0-9_-]{16,}/mu.test(vars)) {
    vars = upsert(vars, 'OIDC_SESSION_SECRET', randomBytes(32).toString('base64url'));
    step('generated a new OIDC_SESSION_SECRET');
  }
  writeFileSync('.dev.vars', vars);
  step('wrote .dev.vars');
}

console.log(`\n  KeyForge ${ISSUER} — configuring "${CLIENT_ID}"\n`);
await assertReachable();
step('discovery ok');
await signIn();
step(`signed in as ${USERNAME}`);
await ensureResource();
const clientSecret = await ensureClient();
await verifyClient();
writeDevVars(clientSecret);
console.log(`\n  Done. Run "pnpm dev" and sign in with ${USERNAME} / ${PASSWORD}.\n`);
