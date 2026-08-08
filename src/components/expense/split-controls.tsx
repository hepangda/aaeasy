import { Minus, Plus, X } from 'lucide-react';
import { NumericInput } from '@/components/ui/numeric-input';

/**
 * Tap-friendly integer share stepper. The middle input stays editable so
 * power users can still type, but most adjustments are one tap on ±.
 */
export function SharesStepper({
  value,
  disabled,
  onChange,
  onBump,
  decLabel,
  incLabel,
  label,
}: {
  value: string;
  disabled: boolean;
  onChange: (v: string) => void;
  onBump: (delta: number) => void;
  decLabel: string;
  incLabel: string;
  label: string;
}) {
  const n = parseInt(value || '0', 10);
  const canDec = !disabled && Number.isFinite(n) && n > 0;
  return (
    <div className="border-input bg-background inline-flex h-9 w-full max-w-[120px] items-stretch overflow-hidden rounded-md border">
      <button
        type="button"
        onClick={() => onBump(-1)}
        disabled={!canDec}
        aria-label={decLabel}
        className="hover:bg-accent text-muted-foreground disabled:text-muted-foreground/40 grid w-9 place-items-center disabled:cursor-not-allowed"
      >
        <Minus className="size-4" />
      </button>
      <NumericInput
        value={value}
        onChange={(e) => onChange(e.target.value)}
        mode="integer"
        disabled={disabled}
        unstyled
        keypadTitle={label}
        aria-label={label}
        className="w-full min-w-0 flex-1 border-x bg-transparent text-center font-mono text-sm tabular-nums focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-50"
      />
      <button
        type="button"
        onClick={() => onBump(1)}
        aria-label={incLabel}
        className="hover:bg-accent text-muted-foreground grid w-9 place-items-center"
      >
        <Plus className="size-4" />
      </button>
    </div>
  );
}

/** Decimal input that clears with an inline X when it has content. */
export function ExtraInput({
  value,
  onChange,
  precision,
  clearLabel,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  precision: number;
  clearLabel: string;
  label: string;
}) {
  return (
    <div className="relative">
      <NumericInput
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0"
        allowNegative
        precision={precision}
        keypadTitle={label}
        aria-label={label}
        className="h-9 w-full pr-7 pl-2 text-right font-mono tabular-nums"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label={clearLabel}
          className="text-muted-foreground hover:text-foreground absolute top-1/2 right-1.5 grid -translate-y-1/2 place-items-center rounded-md p-0.5"
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  );
}
