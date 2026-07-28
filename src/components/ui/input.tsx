import * as React from 'react';
import { cn } from '@/lib/utils';

export type InputVariant = 'default' | 'display';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  /**
   * `display` is the large borderless treatment used for the primary amount
   * field. It exists as a variant so call sites stop cancelling six properties
   * of the default style with an override string — and so the focus ring is
   * suppressed deliberately in one place rather than accidentally in several.
   */
  variant?: InputVariant;
};

const BASE =
  'text-foreground placeholder:text-muted-foreground/75 w-full transition-[border-color,box-shadow,background-color] duration-150 focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-55';

const VARIANT = {
  default:
    'border-input bg-card hover:border-foreground/25 focus-visible:border-ring focus-visible:ring-ring/14 disabled:bg-muted aria-[invalid=true]:border-destructive aria-[invalid=true]:ring-destructive/14 flex h-10 rounded-md border px-3 py-2 text-sm focus-visible:ring-3',
  display:
    'aria-[invalid=true]:text-destructive-ink h-14 border-0 bg-transparent px-0 font-mono text-3xl font-bold tracking-[-0.04em] shadow-none ring-0 focus-visible:ring-0 sm:h-16 sm:text-4xl',
} as const;

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, variant = 'default', ...props }, ref) => {
    return (
      <input type={type} className={cn(BASE, VARIANT[variant], className)} ref={ref} {...props} />
    );
  },
);
Input.displayName = 'Input';

export { Input };
