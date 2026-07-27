import * as React from 'react';
import { cn } from '@/lib/utils';

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'border-input bg-card text-foreground placeholder:text-muted-foreground/75 hover:border-foreground/25 focus-visible:border-ring focus-visible:ring-ring/14 disabled:bg-muted aria-[invalid=true]:border-destructive aria-[invalid=true]:ring-destructive/14 flex min-h-24 w-full resize-y rounded-md border px-3 py-2.5 text-sm leading-relaxed transition-[border-color,box-shadow,background-color] duration-150 focus-visible:ring-3 focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-55',
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';

export { Textarea };
