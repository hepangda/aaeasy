import { defineConfig } from 'drizzle-kit';
import { normalizePostgresConnectionString } from './packages/db/src/connection-string';

const rawDatabaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;

export default defineConfig({
  dialect: 'postgresql',
  schema: './packages/db/src/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: rawDatabaseUrl ? normalizePostgresConnectionString(rawDatabaseUrl) : '',
  },
  strict: true,
  verbose: true,
});
