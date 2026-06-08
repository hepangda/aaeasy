'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Delete } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import {
  appendDigit,
  appendDot,
  appendMultiZero,
  backspace,
  toggleSign,
  type NumericMode,
} from '@/lib/ui/numeric-keypad';

export type { NumericMode };

interface NumericKeypadProps {
  open: boolean;
  value: string;
  mode: NumericMode;
  precision: number;
  initiallySelected: boolean;
  allowNegative?: boolean;
  onChange: (next: string) => void;
  onClose: () => void;
  title?: string;
}

const LONG_PRESS_DELAY = 300;
const LONG_PRESS_INTERVAL = 80;

export function NumericKeypad({
  open,
  value,
  mode,
  precision,
  initiallySelected,
  allowNegative,
  onChange,
  onClose,
  title,
}: NumericKeypadProps) {
  const t = useTranslations('common');
  const [selected, setSelected] = useState(initiallySelected);

  const valueRef = useRef(value);
  const selectedRef = useRef(selected);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  function clearLongPress() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    if (longPressInterval.current) {
      clearInterval(longPressInterval.current);
      longPressInterval.current = null;
    }
  }

  useEffect(() => clearLongPress, []);

  function consumeSelectionForAppend(): string {
    if (!selectedRef.current) return valueRef.current;
    setSelected(false);
    return '';
  }

  function pressDigit(digit: string) {
    const base = consumeSelectionForAppend();
    const next = appendDigit(base, digit, mode, precision);
    if (next !== valueRef.current) onChange(next);
  }

  function pressMultiZero(zeros: '00' | '000') {
    const base = consumeSelectionForAppend();
    const next = appendMultiZero(base, zeros, mode, precision);
    if (next !== valueRef.current) onChange(next);
  }

  function pressDot() {
    const base = consumeSelectionForAppend();
    const next = appendDot(base, mode, precision);
    if (next !== valueRef.current) onChange(next);
  }

  function pressBackspaceOnce() {
    if (selectedRef.current) {
      setSelected(false);
      onChange('');
      return;
    }
    const next = backspace(valueRef.current);
    if (next !== valueRef.current) onChange(next);
  }

  function handleBackspacePointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    e.preventDefault();
    pressBackspaceOnce();
    longPressTimer.current = setTimeout(() => {
      longPressInterval.current = setInterval(() => {
        const current = valueRef.current;
        if (!current) return;
        onChange(backspace(current));
      }, LONG_PRESS_INTERVAL);
    }, LONG_PRESS_DELAY);
  }

  function pressToggleSign() {
    if (selectedRef.current) setSelected(false);
    const next = toggleSign(valueRef.current);
    if (next !== valueRef.current) onChange(next);
  }

  const isDecimal = mode === 'decimal';
  const dotDisabled = !isDecimal || precision === 0 || value.includes('.');
  const atFullPrecision =
    isDecimal && value.includes('.') && value.length - value.indexOf('.') - 1 >= precision;

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={title} className="pt-2">
      <div className="text-muted-foreground flex items-center justify-between px-4 pt-1 pb-2 text-xs">
        <span>{title}</span>
        <span className="text-foreground text-base font-medium tabular-nums">
          {value || '0'}
        </span>
      </div>
      <div className="grid grid-cols-4 gap-2 p-3 pt-1">
        <KeypadButton onClick={() => pressDigit('7')}>7</KeypadButton>
        <KeypadButton onClick={() => pressDigit('8')}>8</KeypadButton>
        <KeypadButton onClick={() => pressDigit('9')}>9</KeypadButton>
        <KeypadButton
          onPointerDown={handleBackspacePointerDown}
          onPointerUp={clearLongPress}
          onPointerLeave={clearLongPress}
          onPointerCancel={clearLongPress}
          ariaLabel={t('delete')}
          variant="muted"
        >
          <Delete className="size-5" />
        </KeypadButton>

        <KeypadButton onClick={() => pressDigit('4')}>4</KeypadButton>
        <KeypadButton onClick={() => pressDigit('5')}>5</KeypadButton>
        <KeypadButton onClick={() => pressDigit('6')}>6</KeypadButton>
        <KeypadButton
          onClick={() => pressMultiZero('000')}
          disabled={atFullPrecision}
          variant="muted"
        >
          000
        </KeypadButton>

        <KeypadButton onClick={() => pressDigit('1')}>1</KeypadButton>
        <KeypadButton onClick={() => pressDigit('2')}>2</KeypadButton>
        <KeypadButton onClick={() => pressDigit('3')}>3</KeypadButton>
        <KeypadButton
          onClick={() => pressMultiZero('00')}
          disabled={atFullPrecision}
          variant="muted"
        >
          00
        </KeypadButton>

        {isDecimal ? (
          <KeypadButton onClick={pressDot} disabled={dotDisabled} variant="muted">
            .
          </KeypadButton>
        ) : (
          <KeypadSpacer />
        )}
        <KeypadButton onClick={() => pressDigit('0')}>0</KeypadButton>
        {allowNegative ? (
          <KeypadButton onClick={pressToggleSign} variant="muted" ariaLabel="±">
            ±
          </KeypadButton>
        ) : (
          <KeypadSpacer />
        )}
        <KeypadButton onClick={onClose} variant="primary" ariaLabel={t('confirm')}>
          {t('confirm')}
        </KeypadButton>
      </div>
    </BottomSheet>
  );
}

function KeypadButton({
  children,
  onClick,
  onPointerDown,
  onPointerUp,
  onPointerLeave,
  onPointerCancel,
  disabled,
  className,
  variant = 'default',
  ariaLabel,
}: {
  children?: React.ReactNode;
  onClick?: () => void;
  onPointerDown?: (e: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerUp?: () => void;
  onPointerLeave?: () => void;
  onPointerCancel?: () => void;
  disabled?: boolean;
  className?: string;
  variant?: 'default' | 'muted' | 'primary';
  ariaLabel?: string;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerLeave}
      onPointerCancel={onPointerCancel}
      disabled={disabled}
      aria-label={ariaLabel}
      className={cn(
        'h-14 text-xl font-medium tabular-nums select-none',
        variant === 'muted' && 'bg-muted/40',
        variant === 'primary' &&
          'bg-primary text-primary-foreground hover:bg-primary/90 border-transparent',
        className,
      )}
    >
      {children}
    </Button>
  );
}

function KeypadSpacer() {
  return <div aria-hidden className="h-14" />;
}
