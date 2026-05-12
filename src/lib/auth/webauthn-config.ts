/**
 * WebAuthn relying-party constants. Derived from NEXT_PUBLIC_APP_URL so that
 * the rpID matches the host the browser actually loaded the page from.
 *
 * For local dev the URL is http://localhost:3000 → rpID = 'localhost'.
 * In production set NEXT_PUBLIC_APP_URL to the canonical https origin.
 */

const url = new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000');

export const RP_ID = url.hostname;
export const RP_ORIGIN = url.origin;
export const RP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? 'AAEasy';
