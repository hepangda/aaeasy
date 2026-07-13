import { describe, expect, it } from 'vitest';
import { appendDigit, appendDot, appendMultiZero, backspace, toggleSign } from './numeric-keypad';

describe('numeric-keypad helpers', () => {
  describe('appendDigit', () => {
    it('replaces a lone leading zero', () => {
      expect(appendDigit('0', '5', 'decimal', 2)).toBe('5');
    });

    it('appends to a non-zero integer', () => {
      expect(appendDigit('12', '3', 'integer', 0)).toBe('123');
    });

    it('rejects digits past decimal precision', () => {
      expect(appendDigit('1.23', '4', 'decimal', 2)).toBe('1.23');
    });

    it('still allows digits before decimal precision is reached', () => {
      expect(appendDigit('1.2', '3', 'decimal', 2)).toBe('1.23');
    });

    it('appends without trimming when value has decimals', () => {
      expect(appendDigit('0.1', '2', 'decimal', 2)).toBe('0.12');
    });

    it('appends to integer mode without precision cap', () => {
      expect(appendDigit('99', '9', 'integer', 0)).toBe('999');
    });
  });

  describe('appendDot', () => {
    it('inserts 0. when the field is empty', () => {
      expect(appendDot('', 'decimal', 2)).toBe('0.');
    });

    it('appends . to an integer value', () => {
      expect(appendDot('12', 'decimal', 2)).toBe('12.');
    });

    it('does nothing if a dot already exists', () => {
      expect(appendDot('1.2', 'decimal', 2)).toBe('1.2');
    });

    it('does nothing in integer mode', () => {
      expect(appendDot('12', 'integer', 0)).toBe('12');
    });

    it('does nothing when precision is 0', () => {
      expect(appendDot('12', 'decimal', 0)).toBe('12');
    });
  });

  describe('appendMultiZero', () => {
    it('writes a single 0 when starting from empty', () => {
      expect(appendMultiZero('', '00', 'decimal', 2)).toBe('0');
      expect(appendMultiZero('', '000', 'decimal', 2)).toBe('0');
    });

    it('appends two zeros after a non-zero integer', () => {
      expect(appendMultiZero('5', '00', 'decimal', 2)).toBe('500');
    });

    it('appends three zeros after a non-zero integer', () => {
      expect(appendMultiZero('5', '000', 'decimal', 2)).toBe('5000');
    });

    it('respects decimal precision when appending multiple zeros', () => {
      expect(appendMultiZero('1.2', '000', 'decimal', 2)).toBe('1.20');
    });

    it('does not overflow precision', () => {
      expect(appendMultiZero('1.23', '00', 'decimal', 2)).toBe('1.23');
    });
  });

  describe('backspace', () => {
    it('removes the last character', () => {
      expect(backspace('123')).toBe('12');
    });

    it('is a no-op on an empty string', () => {
      expect(backspace('')).toBe('');
    });

    it('removes the dot too', () => {
      expect(backspace('1.')).toBe('1');
    });
  });

  describe('toggleSign', () => {
    it('flips a positive value to negative', () => {
      expect(toggleSign('12.5')).toBe('-12.5');
    });

    it('flips a negative value to positive', () => {
      expect(toggleSign('-12.5')).toBe('12.5');
    });

    it('does nothing on empty', () => {
      expect(toggleSign('')).toBe('');
    });

    it('does nothing on a bare zero', () => {
      expect(toggleSign('0')).toBe('0');
    });
  });

  describe('signed inputs preserve the leading minus', () => {
    it('appends digits onto a negative value', () => {
      expect(appendDigit('-1', '2', 'decimal', 2)).toBe('-12');
    });

    it('appends the dot onto a negative value', () => {
      expect(appendDot('-12', 'decimal', 2)).toBe('-12.');
    });

    it('enforces precision on negative values', () => {
      expect(appendDigit('-1.23', '4', 'decimal', 2)).toBe('-1.23');
    });

    it('replaces a lone "-0"-style leading zero', () => {
      expect(appendDigit('-0', '5', 'decimal', 2)).toBe('-5');
    });
  });
});
