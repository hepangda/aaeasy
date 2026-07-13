import { generateToken } from '../lib/crypto';

export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
export const ALLOWED_RECEIPT_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'application/pdf',
]);

function extensionFor(mime: string): string {
  return (
    {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif',
      'image/heic': 'heic',
      'application/pdf': 'pdf',
    }[mime] ?? 'bin'
  );
}

export function receiptObjectKey(groupId: string, expenseId: string, mime: string): string {
  return `groups/${groupId}/expenses/${expenseId}/${generateToken(18)}.${extensionFor(mime)}`;
}

export async function readBodyWithLimit(
  request: Request,
  maxBytes = MAX_RECEIPT_BYTES,
): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel('receipt exceeds size limit');
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function deleteReceiptObjects(
  bucket: R2Bucket,
  objectKeys: Iterable<string>,
): Promise<void> {
  const uniqueKeys = [...new Set(objectKeys)];
  for (let index = 0; index < uniqueKeys.length; index += 1_000) {
    await bucket.delete(uniqueKeys.slice(index, index + 1_000));
  }
}
