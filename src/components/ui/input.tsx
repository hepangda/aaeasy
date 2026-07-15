import * as React from 'react';
import { cn } from '@/lib/utils';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'border-input bg-card text-foreground placeholder:text-muted-foreground/80 hover:border-foreground/20 focus-visible:border-ring focus-visible:ring-ring/15 disabled:bg-muted aria-[invalid=true]:border-destructive aria-[invalid=true]:ring-destructive/15 flex h-11 w-full rounded-lg border px-3.5 py-2 text-sm shadow-sm transition-[border-color,box-shadow,background-color] duration-200 focus-visible:ring-4 focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-55',
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';

export { Input };
