/**
 * S3-compatible storage client.
 *
 * In dev: MinIO at http://localhost:9000 with `forcePathStyle = true`.
 * In prod: any S3-compatible endpoint (MinIO, AWS S3, R2, etc.).
 *
 * Receipts are uploaded directly from the browser via a presigned PUT URL —
 * the file never touches our Next.js process. After a successful upload, the
 * client calls `POST /api/groups/:id/expenses/:expenseId/receipts` to record
 * the metadata.
 *
 * Object keys are namespaced as `group/<groupId>/expense/<expenseId>/<random>`.
 */

import { GetObjectCommand, PutObjectCommand, S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomBytes } from 'node:crypto';

let cached: S3Client | null = null;

export function getS3Client(): S3Client {
  if (cached) return cached;
  cached = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION ?? 'us-east-1',
    credentials: {
      accessKeyId: requireEnv('S3_ACCESS_KEY'),
      secretAccessKey: requireEnv('S3_SECRET_KEY'),
    },
    forcePathStyle:
      (process.env.S3_FORCE_PATH_STYLE ?? 'true').toLowerCase() === 'true',
  });
  return cached;
}

export function getBucket(): string {
  return requireEnv('S3_BUCKET');
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

export function buildReceiptKey(groupId: string, expenseId: string, ext: string): string {
  const safeExt = ext.replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'bin';
  const id = randomBytes(12).toString('hex');
  return `group/${groupId}/expense/${expenseId}/${id}.${safeExt}`;
}

export async function presignPut(
  key: string,
  contentType: string,
  contentLength: number,
  ttlSeconds = 60,
): Promise<string> {
  const client = getS3Client();
  const cmd = new PutObjectCommand({
    Bucket: getBucket(),
    Key: key,
    ContentType: contentType,
    ContentLength: contentLength,
  });
  return getSignedUrl(client, cmd, { expiresIn: ttlSeconds });
}

export async function presignGet(key: string, ttlSeconds = 300): Promise<string> {
  const client = getS3Client();
  const cmd = new GetObjectCommand({
    Bucket: getBucket(),
    Key: key,
  });
  return getSignedUrl(client, cmd, { expiresIn: ttlSeconds });
}

export async function deleteObject(key: string): Promise<void> {
  const client = getS3Client();
  await client.send(new DeleteObjectCommand({ Bucket: getBucket(), Key: key }));
}

// Upload constraints — kept here for both server and client to reference.
export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024; // 5 MiB
export const ALLOWED_RECEIPT_MIMES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'application/pdf',
] as const;

export function isAllowedReceiptMime(mime: string): boolean {
  return (ALLOWED_RECEIPT_MIMES as readonly string[]).includes(mime);
}

export function extFromMime(mime: string): string {
  switch (mime) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    case 'image/heic':
      return 'heic';
    case 'application/pdf':
      return 'pdf';
    default:
      return 'bin';
  }
}
