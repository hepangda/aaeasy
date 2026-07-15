import * as React from 'react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
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
      if (!isControlled) setInternal(e.target.value);
      onValueChange?.(e.target.value);
      onChange?.({ target: { value: e.target.value, name } });
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
      return unstyled ? <input {...desktopProps} /> : <Input {...desktopProps} />;
    }

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
        setOpen(true);
      },
      onFocus: (e: React.FocusEvent<HTMLInputElement>) => {
        onFocus?.(e);
        if (e.defaultPrevented || disabled || readOnly) return;
        e.currentTarget.blur();
        setOpen(true);
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
