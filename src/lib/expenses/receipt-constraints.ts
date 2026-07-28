/** Receipt upload constraints, shared by the composer and the receipt list. */

export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;

/** Images above this are too large to send to the AI parser. */
export const MAX_AI_IMAGE_BYTES = 3 * 1024 * 1024;

export const ALLOWED_RECEIPT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'application/pdf',
]);
