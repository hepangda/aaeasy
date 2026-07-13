import { describe, expect, it } from 'vitest';
import { normalizePostgresConnectionString } from './connection-string';

describe('normalizePostgresConnectionString', () => {
  it('removes the Prisma-only schema query parameter', () => {
    expect(
      normalizePostgresConnectionString(
        'postgresql://user:secret@example.test/database?schema=public&sslmode=require',
      ),
    ).toBe('postgresql://user:secret@example.test/database?sslmode=require');
  });

  it('preserves a connection string without Prisma parameters', () => {
    expect(normalizePostgresConnectionString('postgresql://localhost/database')).toBe(
      'postgresql://localhost/database',
    );
  });
});
