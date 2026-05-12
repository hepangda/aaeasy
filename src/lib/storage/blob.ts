import { del, get } from '@vercel/blob';
import { randomBytes } from 'node:crypto';

export const BLOB_ACCESS = 'private' as const;

export function buildReceiptPrefix(groupId: string, expenseId: string): string {
  return `group/${groupId}/expense/${expenseId}/`;
}

export function buildReceiptPathname(groupId: string, expenseId: string, ext: string): string {
  const safeExt = ext.replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'bin';
  const id = randomBytes(12).toString('hex');
  return `${buildReceiptPrefix(groupId, expenseId)}${id}.${safeExt}`;
}

export async function getReceiptBlob(pathname: string) {
  return get(pathname, { access: BLOB_ACCESS });
}

export async function deleteBlob(pathname: string): Promise<void> {
  await del(pathname);
}

export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
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
