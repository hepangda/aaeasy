import { describe, expect, it } from 'vitest';
import { parsePageNumber } from './pagination';

describe('parsePageNumber', () => {
  it('normalizes missing, invalid, and negative page values to the first page', () => {
    expect(parsePageNumber(undefined)).toBe(1);
    expect(parsePageNumber(null)).toBe(1);
    expect(parsePageNumber('invalid')).toBe(1);
    expect(parsePageNumber('-4')).toBe(1);
    expect(parsePageNumber('0')).toBe(1);
  });

  it('keeps a legitimate page number', () => {
    expect(parsePageNumber('3')).toBe(3);
  });
});
