import * as React from 'react';
import { cn } from '@/lib/utils';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'border-input bg-card text-foreground placeholder:text-muted-foreground/75 hover:border-foreground/25 focus-visible:border-ring focus-visible:ring-ring/14 disabled:bg-muted aria-[invalid=true]:border-destructive aria-[invalid=true]:ring-destructive/14 flex h-10 w-full rounded-md border px-3 py-2 text-sm transition-[border-color,box-shadow,background-color] duration-150 focus-visible:ring-3 focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-55',
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
