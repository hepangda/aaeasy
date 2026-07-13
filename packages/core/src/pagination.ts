/**
 * Server-callable slice helper for the URL-search-param pagination scheme
 * implemented by `<Pagination>` in `pagination.tsx`. Lives in its own module
 * so a server component can import it without pulling in the client bundle.
 */

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

export function getPageSlice<T>(
  items: readonly T[],
  pageRaw: string | undefined,
  pageSize: number,
): { slice: T[]; page: number; totalPages: number } {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const page = clamp(parseInt(pageRaw ?? '1', 10) || 1, 1, totalPages);
  const start = (page - 1) * pageSize;
  return { slice: items.slice(start, start + pageSize), page, totalPages };
}
