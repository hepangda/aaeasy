import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import {
  convertMinor,
  decimalToMinor,
  formatMinor,
  isCurrencyCode,
  minorToDecimal,
  minorUnits,
  parseAmountToMinor,
  sumBig,
} from './index';

describe('minorUnits', () => {
  it('defaults to 2', () => {
    expect(minorUnits('USD')).toBe(2);
    expect(minorUnits('CNY')).toBe(2);
    expect(minorUnits('EUR')).toBe(2);
  });
  it('handles 0-digit currencies', () => {
    expect(minorUnits('JPY')).toBe(0);
    expect(minorUnits('KRW')).toBe(0);
  });
  it('handles 3-digit currencies', () => {
    expect(minorUnits('KWD')).toBe(3);
    expect(minorUnits('BHD')).toBe(3);
  });
  it('is case-insensitive', () => {
    expect(minorUnits('jpy')).toBe(0);
  });
});

describe('parseAmountToMinor', () => {
  it('parses plain decimals', () => {
    expect(parseAmountToMinor('10', 'CNY')).toBe(1000n);
    expect(parseAmountToMinor('10.5', 'CNY')).toBe(1050n);
    expect(parseAmountToMinor('10.55', 'CNY')).toBe(1055n);
  });
  it('handles 0-digit currencies (no decimal)', () => {
    expect(parseAmountToMinor('1234', 'JPY')).toBe(1234n);
    // round-half-even on 0 places means .5 → nearest even
    expect(parseAmountToMinor('1234.5', 'JPY')).toBe(1234n); // even side
    expect(parseAmountToMinor('1235.5', 'JPY')).toBe(1236n);
  });
  it('handles 3-digit currencies', () => {
    expect(parseAmountToMinor('1.234', 'KWD')).toBe(1234n);
    expect(parseAmountToMinor('1.2345', 'KWD')).toBe(1234n); // banker's rounding
  });
  it('strips thousands separators (comma)', () => {
    expect(parseAmountToMinor('1,234.56', 'USD')).toBe(123456n);
    expect(parseAmountToMinor('1,234,567', 'USD')).toBe(123456700n);
  });
  it('treats single comma as decimal mark (EU style)', () => {
    expect(parseAmountToMinor('10,5', 'EUR')).toBe(1050n);
  });
  it('strips spaces and underscores', () => {
    expect(parseAmountToMinor('1 234.56', 'USD')).toBe(123456n);
    expect(parseAmountToMinor('1_234.56', 'USD')).toBe(123456n);
  });
  it('rejects empty / negative / invalid', () => {
    expect(() => parseAmountToMinor('', 'USD')).toThrow();
    expect(() => parseAmountToMinor('  ', 'USD')).toThrow();
    expect(() => parseAmountToMinor('-1', 'USD')).toThrow(/NEGATIVE/);
    expect(() => parseAmountToMinor('abc', 'USD')).toThrow();
    expect(() => parseAmountToMinor('1.2.3', 'USD')).toThrow();
  });
});

describe('decimalToMinor / minorToDecimal', () => {
  it('round-trips losslessly', () => {
    const cases: [string, string][] = [
      ['0.01', 'USD'],
      ['1234567.89', 'USD'],
      ['0', 'JPY'],
      ['1.234', 'KWD'],
    ];
    for (const [val, cur] of cases) {
      const m = decimalToMinor(val, cur);
      expect(minorToDecimal(m, cur).toString()).toBe(new Decimal(val).toString());
    }
  });
});

describe('formatMinor', () => {
  it('renders with the right precision', () => {
    expect(formatMinor(1055n, 'CNY')).toBe('10.55');
    expect(formatMinor(0n, 'USD')).toBe('0.00');
    expect(formatMinor(1234n, 'JPY')).toBe('1234');
    expect(formatMinor(1234n, 'KWD')).toBe('1.234');
  });
  it('handles negative', () => {
    expect(formatMinor(-1055n, 'CNY')).toBe('-10.55');
    expect(formatMinor(-5n, 'USD')).toBe('-0.05');
  });
});

describe('convertMinor', () => {
  it('returns input when currencies match', () => {
    expect(convertMinor(1000n, 'USD', 'USD', '0.5')).toBe(1000n);
  });
  it('converts USD→JPY rounding correctly', () => {
    // 10.00 USD * 150.123 = 1501.23 JPY -> rounds to 1501 (JPY 0 dp)
    expect(convertMinor(1000n, 'USD', 'JPY', '150.123')).toBe(1501n);
  });
  it('converts CNY→USD with 2 dp', () => {
    // 100.00 CNY * 0.1389 = 13.89 USD
    expect(convertMinor(10000n, 'CNY', 'USD', '0.1389')).toBe(1389n);
  });
});

describe('sumBig', () => {
  it('sums an iterable of bigints', () => {
    expect(sumBig([1n, 2n, 3n])).toBe(6n);
    expect(sumBig([])).toBe(0n);
  });
});

describe('isCurrencyCode', () => {
  it('matches 3 uppercase letters only', () => {
    expect(isCurrencyCode('USD')).toBe(true);
    expect(isCurrencyCode('usd')).toBe(false);
    expect(isCurrencyCode('US')).toBe(false);
    expect(isCurrencyCode('USDD')).toBe(false);
    expect(isCurrencyCode('US1')).toBe(false);
  });
});
