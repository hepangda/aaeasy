import 'dotenv/config';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { normalizePostgresConnectionString } from '../packages/db/src/connection-string';
import postgres from 'postgres';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { drizzle } from 'drizzle-orm/postgres-js';

const expectedTables = [
  'allowed_usernames',
  'audit_logs',
  'auth_challenges',
  'expense_splits',
  'expenses',
  'fx_rate_cache',
  'group_invitations',
  'group_memberships',
  'groups',
  'members',
  'passkey_credentials',
  'password_credentials',
  'receipts',
  'sessions',
  'settlement_entries',
  'settlements',
  'share_links',
  'share_sessions',
  'users',
] as const;

const rawDatabaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
if (!rawDatabaseUrl) throw new Error('DIRECT_DATABASE_URL or DATABASE_URL is required');
const databaseUrl = normalizePostgresConnectionString(rawDatabaseUrl);
if (!process.argv.includes('--yes')) {
  throw new Error('Refusing to modify migration metadata without --yes');
}

const journal = JSON.parse(await readFile('drizzle/meta/_journal.json', 'utf8')) as {
  entries: Array<{ idx: number; tag: string; when: number }>;
};
const baseline = journal.entries.find((entry) => entry.idx === 0);
const revision = journal.entries.find((entry) => entry.idx === 1);
if (!baseline || !revision) throw new Error('Expected baseline and revision migrations');

const client = postgres(databaseUrl, { max: 1 });
try {
  const tableRows = await client<{ table_name: string }[]>`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
  `;
  const present = new Set(tableRows.map((row) => row.table_name));
  const missing = expectedTables.filter((table) => !present.has(table));
  if (missing.length > 0) {
    throw new Error(`Database is not an AAEasy schema; missing: ${missing.join(', ')}`);
  }

  await client`create schema if not exists drizzle`;
  await client`
    create table if not exists drizzle.__drizzle_migrations (
      id serial primary key,
      hash text not null,
      created_at bigint
    )
  `;
  const existing = await client<{ created_at: string }[]>`
    select created_at from drizzle.__drizzle_migrations order by created_at desc limit 1
  `;
  if (existing.length > 0) {
    throw new Error('Drizzle migration metadata already exists; run pnpm db:migrate instead');
  }

  const columns = await client<{ table_name: string; column_name: string }[]>`
    select table_name, column_name
    from information_schema.columns
    where table_schema = 'public'
      and ((table_name = 'groups' and column_name = 'revision')
        or (table_name = 'expenses' and column_name = 'version'))
  `;
  const hasRevision = columns.some(
    (column) => column.table_name === 'groups' && column.column_name === 'revision',
  );
  const hasVersion = columns.some(
    (column) => column.table_name === 'expenses' && column.column_name === 'version',
  );
  if (hasRevision !== hasVersion) {
    throw new Error('Cloudflare revision columns are only partially installed');
  }

  async function migrationHash(tag: string) {
    const sql = await readFile(`drizzle/${tag}.sql`, 'utf8');
    return createHash('sha256').update(sql).digest('hex');
  }

  await client.begin(async (transaction) => {
    await transaction`
      insert into drizzle.__drizzle_migrations (hash, created_at)
      values (${await migrationHash(baseline.tag)}, ${baseline.when})
    `;
    if (hasRevision && hasVersion) {
      await transaction`
        insert into drizzle.__drizzle_migrations (hash, created_at)
        values (${await migrationHash(revision.tag)}, ${revision.when})
      `;
    }
  });

  if (!hasRevision) {
    await migrate(drizzle(client), { migrationsFolder: 'drizzle' });
  }
  console.log('Drizzle now owns the existing AAEasy schema.');
} finally {
  await client.end();
}
