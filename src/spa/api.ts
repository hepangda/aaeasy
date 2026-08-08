import type { QueryKey } from '@tanstack/react-query';
import { queryClient } from './query-client';

/** A request that reached the server and came back with a non-2xx status. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** The shape every mutating endpoint answers with. */
export interface ActionResult {
  ok: boolean;
  error?: string;
  /** Present on failure: the HTTP status, or 0 when the request never landed. */
  status?: number;
  fieldErrors?: Record<string, string>;
}

/**
 * Caches a mutation can invalidate.
 *
 * Kept as named sets rather than one blanket list: a rename touches the group
 * and the ledger list, an expense touches neither. Passing everything
 * everywhere is what made a single expense write refetch three queries.
 */
export function ledgerQueryKeys(groupId: string): readonly QueryKey[] {
  return [['ledger', groupId]];
}

export function groupQueryKeys(groupId: string): readonly QueryKey[] {
  return [
    ['group', groupId],
    ['ledger', groupId],
  ];
}

export function groupAndListQueryKeys(groupId: string): readonly QueryKey[] {
  return [...groupQueryKeys(groupId), ['groups']];
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body && !(init.body instanceof FormData)
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...init?.headers,
    },
  });
  const contentType = response.headers.get('content-type') ?? '';
  const body = contentType.includes('application/json')
    ? await response.json()
    : await response.text();
  if (!response.ok) {
    throw new ApiError(errorCode(body) ?? `HTTP_${response.status}`, response.status, body);
  }
  return body as T;
}

function errorCode(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('error' in body)) return null;
  const error = (body as { error: unknown }).error;
  return typeof error === 'string' ? error : null;
}

/**
 * Run a mutation and refresh what it invalidated.
 *
 * Failures are returned rather than thrown, but they stay *distinguishable*:
 * a rejection the server explained keeps that explanation and its status,
 * while a request that never completed reports `errors.network`. Collapsing
 * both into a generic "unknown" — as this used to — leaves the caller unable
 * to tell "the server said no" from "your connection dropped", and so unable
 * to offer a retry.
 */
export async function actionRequest<T extends ActionResult>(
  path: string,
  init?: RequestInit,
  queryKeys: readonly QueryKey[] = [],
): Promise<T> {
  try {
    const result = await apiRequest<T>(path, init);
    for (const queryKey of queryKeys) {
      void queryClient.invalidateQueries({ queryKey });
    }
    return result;
  } catch (error) {
    if (error instanceof ApiError) {
      const body = error.body;
      if (typeof body === 'object' && body !== null && 'ok' in body) {
        return { ...(body as T), status: error.status };
      }
      return { ok: false, error: error.message, status: error.status } as T;
    }
    return { ok: false, error: 'errors.network', status: 0 } as T;
  }
}
