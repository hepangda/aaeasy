import { describe, expect, it } from 'vitest';
import { readBodyWithLimit, receiptObjectKey } from './receipts';

describe('receipt storage', () => {
  it('builds private hierarchical object keys', () => {
    const key = receiptObjectKey('group-1', 'expense-1', 'image/png');
    expect(key).toMatch(/^groups\/group-1\/expenses\/expense-1\/[A-Za-z0-9_-]+\.png$/u);
  });

  it('reads a body without exceeding the configured limit', async () => {
    const request = new Request('https://aaeasy.invalid/upload', {
      method: 'POST',
      body: new Blob([new Uint8Array([1, 2, 3])]),
    });
    expect([...((await readBodyWithLimit(request, 3)) ?? [])]).toEqual([1, 2, 3]);
  });

  it('rejects a body larger than the configured limit', async () => {
    const request = new Request('https://aaeasy.invalid/upload', {
      method: 'POST',
      body: new Blob([new Uint8Array([1, 2, 3, 4])]),
    });
    expect(await readBodyWithLimit(request, 3)).toBeNull();
  });
});
