'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Delete } from 'lucide-react';
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
  const [draft, setDraft] = useState(value);

  const draftRef = useRef(draft);
  const selectedRef = useRef(selected);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  // Each time the sheet opens, snapshot the parent's current value as the
  // draft and re-arm the "selected" state so the first digit overwrites.
  // Changes during this session stay local until the user taps Confirm.
  useEffect(() => {
    if (!open) return;
    setDraft(value);
    setSelected(initiallySelected);
    draftRef.current = value;
    selectedRef.current = initiallySelected;
    // We intentionally only re-snapshot on open transitions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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
    if (!selectedRef.current) return draftRef.current;
    setSelected(false);
    return '';
  }

  function pressDigit(digit: string) {
    const base = consumeSelectionForAppend();
    const next = appendDigit(base, digit, mode, precision);
    if (next !== draftRef.current) setDraft(next);
  }

  function pressMultiZero(zeros: '00' | '000') {
    const base = consumeSelectionForAppend();
    const next = appendMultiZero(base, zeros, mode, precision);
    if (next !== draftRef.current) setDraft(next);
  }

  function pressDot() {
    const base = consumeSelectionForAppend();
    const next = appendDot(base, mode, precision);
    if (next !== draftRef.current) setDraft(next);
  }

  function pressBackspaceOnce() {
    if (selectedRef.current) {
      setSelected(false);
      setDraft('');
      return;
    }
    const next = backspace(draftRef.current);
    if (next !== draftRef.current) setDraft(next);
  }

  function handleBackspacePointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    e.preventDefault();
    pressBackspaceOnce();
    longPressTimer.current = setTimeout(() => {
      longPressInterval.current = setInterval(() => {
        const current = draftRef.current;
        if (!current) return;
        setDraft(backspace(current));
      }, LONG_PRESS_INTERVAL);
    }, LONG_PRESS_DELAY);
  }

  function pressToggleSign() {
    if (selectedRef.current) setSelected(false);
    const next = toggleSign(draftRef.current);
    if (next !== draftRef.current) setDraft(next);
  }

  function pressConfirm() {
    if (draftRef.current !== value) onChange(draftRef.current);
    onClose();
  }

  const isDecimal = mode === 'decimal';
  const dotDisabled = !isDecimal || precision === 0 || draft.includes('.');
  const atFullPrecision =
    isDecimal && draft.includes('.') && draft.length - draft.indexOf('.') - 1 >= precision;

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={title} className="pt-2">
      <div className="text-muted-foreground flex items-center justify-between px-4 pt-1 pb-2 text-xs">
        <span>{title}</span>
        <span className="text-foreground text-base font-medium tabular-nums">
          {draft || '0'}
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
        <KeypadButton onClick={pressConfirm} variant="primary" ariaLabel={t('confirm')}>
          <Check className="size-5" />
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
