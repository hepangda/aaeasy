import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { AppEnv } from '../app-env';

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: ContentfulStatusCode,
    public readonly detail?: string,
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

export function handleApiError(error: Error, c: Context<AppEnv>) {
  if (error instanceof ApiError) {
    return c.json(
      { error: error.code, ...(error.detail ? { detail: error.detail } : {}) },
      error.status,
    );
  }

  console.error(error);
  return c.json({ error: 'INTERNAL_ERROR' }, 500);
}
