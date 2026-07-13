import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

type ManifestEntry = {
  objectKey: string;
  sourceUrl: string;
  mime?: string;
  sizeBytes?: number;
};

type Options = {
  manifest: string;
  bucket: string;
  environment: string;
  target: 'local' | 'remote';
  confirmed: boolean;
  dryRun: boolean;
};

function usage(): never {
  console.log(`Usage:
  pnpm r2:migrate -- --manifest ./receipts.jsonl --bucket aaeasy-receipts --remote --yes

Each JSONL row must contain: {"objectKey":"...","sourceUrl":"...","mime":"...","sizeBytes":123}
Use --local instead of --remote for a local rehearsal. Set RECEIPT_SOURCE_BEARER_TOKEN when the source URLs require bearer authentication.`);
  process.exit(0);
}

function parseArgs(): Options {
  const options: Partial<Options> = {
    bucket: process.env.R2_BUCKET_NAME ?? 'aaeasy-receipts',
    environment: 'production',
    confirmed: false,
    dryRun: false,
  };
  const args = process.argv.slice(2).filter((argument) => argument !== '--');
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    const next = () => {
      const value = args[++index];
      if (!value) throw new Error(`Missing value for ${argument}`);
      return value;
    };
    if (argument === '--help' || argument === '-h') usage();
    else if (argument === '--manifest') options.manifest = next();
    else if (argument === '--bucket') options.bucket = next();
    else if (argument === '--env') options.environment = next();
    else if (argument === '--remote') options.target = 'remote';
    else if (argument === '--local') options.target = 'local';
    else if (argument === '--yes') options.confirmed = true;
    else if (argument === '--dry-run') options.dryRun = true;
    else throw new Error(`Unknown option: ${argument}`);
  }
  if (!options.manifest) throw new Error('--manifest is required');
  if (!options.target) throw new Error('Choose exactly one of --local or --remote');
  if (options.target === 'remote' && !options.confirmed && !options.dryRun) {
    throw new Error('Remote writes require --yes');
  }
  return options as Options;
}

function validateEntry(value: unknown, line: number): ManifestEntry {
  if (!value || typeof value !== 'object') throw new Error(`Manifest row ${line} is not an object`);
  const entry = value as Partial<ManifestEntry>;
  if (
    typeof entry.objectKey !== 'string' ||
    entry.objectKey.length === 0 ||
    new TextEncoder().encode(entry.objectKey).byteLength > 1_024 ||
    /[\0\r\n]/u.test(entry.objectKey)
  ) {
    throw new Error(`Manifest row ${line} has an invalid objectKey`);
  }
  if (typeof entry.sourceUrl !== 'string' || !/^https?:\/\//u.test(entry.sourceUrl)) {
    throw new Error(`Manifest row ${line} has an invalid sourceUrl`);
  }
  if (entry.mime !== undefined && typeof entry.mime !== 'string') {
    throw new Error(`Manifest row ${line} has an invalid mime`);
  }
  if (
    entry.sizeBytes !== undefined &&
    (!Number.isInteger(entry.sizeBytes) || entry.sizeBytes < 0)
  ) {
    throw new Error(`Manifest row ${line} has an invalid sizeBytes`);
  }
  return entry as ManifestEntry;
}

async function readManifest(filePath: string): Promise<ManifestEntry[]> {
  const source = (await readFile(filePath, 'utf8')).trim();
  if (!source) return [];
  if (source.startsWith('[')) {
    const parsed = JSON.parse(source) as unknown;
    if (!Array.isArray(parsed)) throw new Error('JSON manifest must be an array');
    return parsed.map((entry, index) => validateEntry(entry, index + 1));
  }
  return source
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0)
    .map((line, index) => validateEntry(JSON.parse(line) as unknown, index + 1));
}

async function runWrangler(arguments_: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('pnpm', ['exec', 'wrangler', ...arguments_], { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`wrangler exited with code ${code ?? 'unknown'}`));
    });
  });
}

async function main() {
  const options = parseArgs();
  const entries = await readManifest(options.manifest);
  const seenKeys = new Set<string>();
  for (const entry of entries) {
    if (seenKeys.has(entry.objectKey)) throw new Error('Manifest contains duplicate object keys');
    seenKeys.add(entry.objectKey);
  }
  console.log(`${options.dryRun ? 'Checking' : 'Migrating'} ${entries.length} receipt objects.`);
  if (options.dryRun) {
    for (const entry of entries) console.log(`${entry.objectKey} <- ${entry.sourceUrl}`);
    return;
  }

  const directory = await mkdtemp(path.join(tmpdir(), 'aaeasy-r2-'));
  const bearerToken = process.env.RECEIPT_SOURCE_BEARER_TOKEN;
  try {
    for (const [index, entry] of entries.entries()) {
      const response = await fetch(entry.sourceUrl, {
        headers: bearerToken ? { Authorization: `Bearer ${bearerToken}` } : undefined,
        redirect: 'follow',
      });
      if (!response.ok)
        throw new Error(`${entry.objectKey}: source returned HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (entry.sizeBytes !== undefined && bytes.byteLength !== entry.sizeBytes) {
        throw new Error(
          `${entry.objectKey}: expected ${entry.sizeBytes} bytes, received ${bytes.byteLength}`,
        );
      }
      const mime =
        entry.mime ??
        response.headers.get('content-type')?.split(';')[0] ??
        'application/octet-stream';
      const temporaryFile = path.join(directory, String(index));
      await writeFile(temporaryFile, bytes);
      await runWrangler([
        'r2',
        'object',
        'put',
        `${options.bucket}/${entry.objectKey}`,
        '--file',
        temporaryFile,
        '--content-type',
        mime,
        '--cache-control',
        'private, max-age=300',
        `--${options.target}`,
        '--env',
        options.environment,
        '--force',
      ]);
      console.log(`[${index + 1}/${entries.length}] ${entry.objectKey}`);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

await main();
