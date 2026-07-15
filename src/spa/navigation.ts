export function safeInternalPath(value: string | null | undefined): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return null;
  }
  const base = new URL('https://aaeasy.invalid');
  const parsed = new URL(value, base);
  if (parsed.origin !== base.origin) return null;
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}
