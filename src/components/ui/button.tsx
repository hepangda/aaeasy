import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { usePressable } from '@/hooks/use-pressable';

const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold',
    // Transform is on its own fast track: the press must register immediately,
    // while colour can afford to catch up.
    'transition-[color,background-color,border-color,box-shadow] duration-150 ease-out',
    'focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-ring/22',
    'disabled:pointer-events-none disabled:opacity-45',
    '[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  ].join(' '),
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline:
          'border border-input bg-card text-foreground hover:border-primary/35 hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/75',
        ghost: 'text-foreground shadow-none hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary-ink shadow-none underline-offset-4 hover:text-primary-ink/80 hover:underline',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 px-3',
        lg: 'h-11 px-5',
        // 44px — the iOS/Android touch-target minimum. Icon-only buttons carry
        // no text to widen their hit area, so they must not shrink below this.
        icon: 'size-11',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

/**
 * Feedback fires on pointer-*down*, not on click.
 *
 * This previously used `active:translate-y-px`, which is both too subtle to
 * register and, on touch, applied late. A scale reads as the surface taking the
 * pressure — and because it's driven from `pointerdown`, it lands on the same
 * frame as the touch rather than waiting for release.
 */
const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, style, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    const { pressProps, pressStyle } = usePressable({ scale: 0.97, disabled: Boolean(disabled) });

    // Callers legitimately need their own pointer handlers (the keypad drives
    // key-repeat from `pointerdown`). Compose rather than letting either side
    // silently win — a spread order bug here would cost the press feedback on
    // exactly the highest-frequency buttons in the app.
    const compose =
      <E,>(ours: (event: E) => void, theirs?: (event: E) => void) =>
      (event: E) => {
        ours(event);
        theirs?.(event);
      };

    return (
      <Comp
        {...props}
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled}
        // The press transform and its transition both arrive via style, so a
        // caller's `transition-*` class can never merge them away.
        style={{ ...style, ...pressStyle }}
        onPointerDown={compose(pressProps.onPointerDown, props.onPointerDown)}
        onPointerMove={compose(pressProps.onPointerMove, props.onPointerMove)}
        onPointerUp={compose(pressProps.onPointerUp, props.onPointerUp)}
        onPointerCancel={compose(pressProps.onPointerCancel, props.onPointerCancel)}
        onPointerLeave={compose(pressProps.onPointerLeave, props.onPointerLeave)}
      />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
