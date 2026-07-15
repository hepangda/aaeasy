import * as React from 'react';
import { cn } from '@/lib/utils';

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        'border-input bg-card text-foreground hover:border-foreground/20 focus-visible:border-ring focus-visible:ring-ring/15 disabled:bg-muted aria-[invalid=true]:border-destructive aria-[invalid=true]:ring-destructive/15 flex h-11 w-full rounded-lg border px-3.5 text-sm shadow-sm transition-[border-color,box-shadow,background-color] duration-200 focus-visible:ring-4 focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-55',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  ),
);
Select.displayName = 'Select';

export { Select };
