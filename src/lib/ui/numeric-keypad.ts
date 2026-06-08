export type NumericMode = 'integer' | 'decimal';

function splitSign(value: string): { sign: '' | '-'; body: string } {
  if (value.startsWith('-')) return { sign: '-', body: value.slice(1) };
  return { sign: '', body: value };
}

export function appendDigit(
  value: string,
  digit: string,
  mode: NumericMode,
  precision: number,
): string {
  const { sign, body } = splitSign(value);
  if (mode === 'decimal') {
    const dot = body.indexOf('.');
    if (dot >= 0 && body.length - dot - 1 >= precision) return value;
  }
  if (body === '0') return sign + digit;
  return sign + body + digit;
}

export function appendDot(value: string, mode: NumericMode, precision: number): string {
  if (mode === 'integer' || precision === 0) return value;
  const { sign, body } = splitSign(value);
  if (body.includes('.')) return value;
  if (body === '') return sign + '0.';
  return sign + body + '.';
}

export function backspace(value: string): string {
  return value.slice(0, -1);
}

export function appendMultiZero(
  value: string,
  zeros: '00' | '000',
  mode: NumericMode,
  precision: number,
): string {
  const { sign, body } = splitSign(value);
  if (body === '') return sign + '0';
  let next = value;
  for (const ch of zeros) next = appendDigit(next, ch, mode, precision);
  return next;
}

export function toggleSign(value: string): string {
  if (value === '' || value === '0') return value;
  if (value.startsWith('-')) return value.slice(1);
  return '-' + value;
}
