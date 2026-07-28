import { useId, type ReactNode } from 'react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/**
 * Wraps a form control with its label, hint and error, and wires the ARIA
 * plumbing between them.
 *
 * The input primitives have shipped `aria-[invalid=true]` styling from the
 * start, but `aria-invalid` appeared *zero* times in the app — every error was
 * routed to a toast, so it could never be attached to the field that caused it.
 * `Field` closes that gap: pass `error` and the control gets `aria-invalid`
 * plus an `aria-describedby` pointing at the message.
 *
 *     <Field label="Amount" error={errors.amount}>
 *       {(props) => <NumericInput {...props} name="amount" />}
 *     </Field>
 */
export function Field({
  label,
  hint,
  error,
  required,
  className,
  children,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  className?: string;
  children: (props: {
    id: string;
    'aria-invalid': boolean | undefined;
    'aria-describedby': string | undefined;
  }) => ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  const describedBy =
    [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <Label htmlFor={id}>
          {label}
          {required && (
            <span className="text-destructive-ink ml-0.5" aria-hidden="true">
              *
            </span>
          )}
        </Label>
      )}

      {children({
        id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': describedBy,
      })}

      {hint && !error && (
        <p id={hintId} className="text-muted-foreground text-xs leading-5">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-destructive-ink text-xs leading-5">
          {error}
        </p>
      )}
    </div>
  );
}
