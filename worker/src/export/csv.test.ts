import { describe, expect, it } from 'vitest';
import { encodeCsvCell } from './csv';

describe('CSV encoding', () => {
  it('quotes commas, quotes, and newlines using RFC 4180 rules', () => {
    expect(encodeCsvCell('meal, "late"\nnight')).toBe('"meal, ""late""\nnight"');
  });

  it('neutralizes spreadsheet formulas in user text', () => {
    expect(encodeCsvCell('=HYPERLINK("https://evil.example")')).toBe(
      '"\'=HYPERLINK(""https://evil.example"")"',
    );
    expect(encodeCsvCell('-12.50')).toBe('-12.50');
  });
});
