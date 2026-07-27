import * as React from 'react';
import { cn } from '@/lib/utils';

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        'border-input bg-card text-foreground hover:border-foreground/25 focus-visible:border-ring focus-visible:ring-ring/14 disabled:bg-muted aria-[invalid=true]:border-destructive aria-[invalid=true]:ring-destructive/14 flex h-10 w-full rounded-md border px-3 text-sm transition-[border-color,box-shadow,background-color] duration-150 focus-visible:ring-3 focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-55',
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
