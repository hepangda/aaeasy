import * as React from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Checkbox with a 44px touch target.
 *
 * The app previously used bare `<input type="checkbox" className="size-4">` as
 * the primary control in the mobile split editor — a 16px target, well under
 * the 44px minimum. Here the visible box stays 20px while an invisible padded
 * hit area around the input meets the touch requirement.
 */
export const Checkbox = React.forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> & {
    /** Visible label; also makes the whole row clickable. */
    label?: React.ReactNode;
    containerClassName?: string;
  }
>(({ className, label, containerClassName, ...props }, ref) => {
  const box = (
    <span className="relative grid size-11 shrink-0 place-items-center">
      <input
        ref={ref}
        type="checkbox"
        className={cn('peer absolute inset-0 size-full cursor-pointer opacity-0', className)}
        {...props}
      />
      <span
        aria-hidden="true"
        className={cn(
          'border-input bg-card grid size-5 place-items-center rounded-md border transition-colors',
          'peer-checked:bg-primary peer-checked:border-primary peer-checked:text-primary-foreground',
          'peer-focus-visible:ring-ring/34 peer-focus-visible:ring-3',
          'peer-disabled:opacity-45',
          // The tick lives inside this span, so it can't carry a `peer-*`
          // variant itself (those compile to a sibling combinator).
          '[&_svg]:opacity-0 peer-checked:[&_svg]:opacity-100',
        )}
      >
        <Check className="size-3.5" strokeWidth={3} />
      </span>
    </span>
  );

  if (!label) return box;

  return (
    <label
      className={cn(
        'flex cursor-pointer items-center gap-1 select-none',
        props.disabled && 'cursor-not-allowed opacity-45',
        containerClassName,
      )}
    >
      {box}
      <span className="min-w-0 truncate text-sm">{label}</span>
    </label>
  );
});
Checkbox.displayName = 'Checkbox';
