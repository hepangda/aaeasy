export function safeInternalPath(value: string | null | undefined): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return null;
  }
  const base = new URL('https://aaeasy.invalid');
  const parsed = new URL(value, base);
  if (parsed.origin !== base.origin) return null;
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export function authRedirect(
  serverRedirect: string | null | undefined,
  requestedPath: string | null | undefined,
  fallback = '/',
): string {
  const serverPath = safeInternalPath(serverRedirect);
  if (serverPath && serverPath !== '/' && serverPath !== '/account') return serverPath;
  return safeInternalPath(requestedPath) ?? serverPath ?? fallback;
}
