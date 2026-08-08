/** PostgreSQL error-code helpers shared by the write routes. */

const UNIQUE_VIOLATION = '23505';
const SERIALIZATION_FAILURE = '40001';
const DEADLOCK_DETECTED = '40P01';

export function postgresErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  if ('code' in error && typeof error.code === 'string') return error.code;
  if ('cause' in error && error.cause !== error) return postgresErrorCode(error.cause);
  return null;
}

export function isUniqueViolation(error: unknown): boolean {
  return postgresErrorCode(error) === UNIQUE_VIOLATION;
}

/** Retryable-by-the-client conflicts: unique clashes and serialization aborts. */
export function isTransactionConflict(error: unknown): boolean {
  return [UNIQUE_VIOLATION, SERIALIZATION_FAILURE, DEADLOCK_DETECTED].includes(
    postgresErrorCode(error) ?? '',
  );
}
