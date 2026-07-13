import { refreshQueries } from './query-client';

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
    const error = new Error(
      typeof body === 'object' && body && 'error' in body
        ? String((body as { error: unknown }).error)
        : `HTTP_${response.status}`,
    );
    Object.assign(error, { status: response.status, body });
    throw error;
  }
  return body as T;
}

export async function actionRequest<T extends { ok?: boolean; error?: string }>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  try {
    const result = await apiRequest<T>(path, init);
    refreshQueries();
    return result;
  } catch (error) {
    if (error && typeof error === 'object' && 'body' in error) {
      return (error as { body: T }).body;
    }
    return { ok: false, error: 'errors.unknown' } as T;
  }
}

export function currentGroupId(): string | null {
  return /^\/groups\/([^/]+)/u.exec(window.location.pathname)?.[1] ?? null;
}

export function formString(formData: FormData, name: string): string {
  return formData.get(name)?.toString() ?? '';
}
