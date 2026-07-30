import * as React from 'react';
import { cn } from '@/lib/utils';
import { Input, type InputVariant } from '@/components/ui/input';
import { NumericKeypad, type NumericMode } from '@/components/ui/numeric-keypad';

export interface NumericInputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'type' | 'onChange'
> {
  value?: string;
  defaultValue?: string;
  mode?: NumericMode;
  precision?: number;
  onChange?: (event: { target: { value: string; name?: string } }) => void;
  onValueChange?: (value: string) => void;
  keypadTitle: string;
  unstyled?: boolean;
  allowNegative?: boolean;
  variant?: InputVariant;
}

/**
 * Keep a typed value to digits (plus one decimal point, and a leading minus
 * when allowed). The mobile path already constrains input by construction —
 * it renders a custom keypad — but on desktop the field is a real text input,
 * so letters, spaces and stray separators would otherwise reach the parser and
 * surface as a validation error instead of simply never being typeable.
 */
function sanitizeNumeric(
  raw: string,
  {
    allowDecimal,
    precision,
    allowNegative,
  }: {
    allowDecimal: boolean;
    precision: number;
    allowNegative: boolean;
  },
): string {
  const negative = allowNegative && raw.trimStart().startsWith('-');
  let digits = raw.replace(/[^\d.]/g, '');
  const firstDot = digits.indexOf('.');
  if (!allowDecimal || precision === 0) {
    digits = digits.replace(/\./g, '');
  } else if (firstDot !== -1) {
    digits =
      digits.slice(0, firstDot + 1) +
      digits
        .slice(firstDot + 1)
        .replace(/\./g, '')
        .slice(0, precision);
  }
  return (negative ? '-' : '') + digits;
}

function useCoarsePointer() {
  const [coarse, setCoarse] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia('(pointer: coarse)');
    const update = () => setCoarse(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return coarse;
}

export const NumericInput = React.forwardRef<HTMLInputElement, NumericInputProps>(
  function NumericInput(
    {
      value,
      defaultValue,
      mode = 'decimal',
      precision = mode === 'integer' ? 0 : 2,
      onChange,
      onValueChange,
      keypadTitle,
      className,
      placeholder,
      inputMode,
      name,
      disabled,
      readOnly,
      onFocus,
      onPointerDown,
      unstyled,
      allowNegative,
      variant,
      ...rest
    },
    ref,
  ) {
    const coarse = useCoarsePointer();

    const isControlled = value !== undefined;
    const [internal, setInternal] = React.useState(defaultValue ?? '');
    const current = isControlled ? value : internal;

    const [open, setOpen] = React.useState(false);

    const emit = React.useCallback(
      (next: string) => {
        if (!isControlled) setInternal(next);
        onValueChange?.(next);
        onChange?.({ target: { value: next, name } });
      },
      [isControlled, onChange, onValueChange, name],
    );

    const fallbackInputMode: NonNullable<typeof inputMode> =
      inputMode ?? (mode === 'integer' ? 'numeric' : 'decimal');

    const desktopOnChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = sanitizeNumeric(e.target.value, {
        allowDecimal: mode !== 'integer',
        precision,
        allowNegative: Boolean(allowNegative),
      });
      // Rewrite the DOM value too: an uncontrolled input keeps whatever was
      // typed otherwise, so a rejected character would linger on screen.
      if (e.target.value !== next) e.target.value = next;
      if (!isControlled) setInternal(next);
      onValueChange?.(next);
      onChange?.({ target: { value: next, name } });
    };

    if (!coarse) {
      const desktopProps = {
        ...rest,
        ref,
        className,
        placeholder,
        inputMode: fallbackInputMode,
        name,
        disabled,
        readOnly,
        onFocus,
        onPointerDown,
        value: isControlled ? value : undefined,
        defaultValue: isControlled ? undefined : defaultValue,
        onChange: desktopOnChange,
      };
      return unstyled ? <input {...desktopProps} /> : <Input variant={variant} {...desktopProps} />;
    }

    // The keypad sheet covers the bottom ~50% of a phone viewport. Without
    // this, editing a field low in a long form means typing blind.
    const revealAndOpen = (el: HTMLInputElement) => {
      setOpen(true);
      requestAnimationFrame(() => {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
    };

    const mobileProps = {
      ...rest,
      ref,
      className: unstyled ? className : cn(!disabled && !readOnly && 'cursor-pointer', className),
      placeholder,
      inputMode: 'none' as const,
      name,
      disabled,
      readOnly: true,
      value: current,
      onPointerDown: (e: React.PointerEvent<HTMLInputElement>) => {
        onPointerDown?.(e);
        if (e.defaultPrevented || disabled || readOnly) return;
        e.preventDefault();
        revealAndOpen(e.currentTarget);
      },
      onFocus: (e: React.FocusEvent<HTMLInputElement>) => {
        onFocus?.(e);
        if (e.defaultPrevented || disabled || readOnly) return;
        e.currentTarget.blur();
        revealAndOpen(e.currentTarget);
      },
    };

    return (
      <>
        {unstyled ? <input {...mobileProps} /> : <Input {...mobileProps} />}
        <NumericKeypad
          open={open}
          value={current}
          mode={mode}
          precision={precision}
          initiallySelected
          allowNegative={allowNegative}
          onChange={emit}
          onClose={() => setOpen(false)}
          title={keypadTitle}
        />
      </>
    );
  },
);
