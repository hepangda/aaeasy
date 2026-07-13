import type { ZodError } from 'zod';

export function fieldErrors(error: ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path[0]?.toString() ?? '_';
    result[key] ??= issue.message;
  }
  return result;
}
