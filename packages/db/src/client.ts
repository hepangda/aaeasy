import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { normalizePostgresConnectionString } from './connection-string';
import * as schema from './schema';

export function createDatabase(connectionString: string) {
  const client = postgres(normalizePostgresConnectionString(connectionString), {
    max: 5,
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  return drizzle(client, { schema });
}

export type Database = ReturnType<typeof createDatabase>;
