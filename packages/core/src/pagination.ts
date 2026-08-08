/**
 * Page-number parsing for the URL-search-param pagination scheme implemented
 * by `<Pagination>`.
 *
 * There is deliberately no client-side slice helper here. The one unbounded
 * collection in the app — a ledger's expenses — is paged by the ledger query,
 * and bounded collections render in full rather than growing a second,
 * client-side pagination scheme alongside it.
 */
export function parsePageNumber(pageRaw: string | null | undefined): number {
  return Math.max(1, parseInt(pageRaw ?? '1', 10) || 1);
}
