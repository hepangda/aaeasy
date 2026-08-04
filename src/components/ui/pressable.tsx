import { Slot } from '@radix-ui/react-slot';
import { usePressable } from '@/hooks/use-pressable';

type PointerHandler = (event: React.PointerEvent<HTMLElement>) => void;

/** Run ours, then theirs — and never let one silently replace the other. */
function compose(ours: PointerHandler, theirs?: PointerHandler): PointerHandler {
  return (event) => {
    ours(event);
    theirs?.(event);
  };
}

/**
 * Press feedback for the things that are tappable but aren't `<Button>`s —
 * list rows, navigation items, card links, table rows.
 *
 * Those surfaces carry most of the taps in this app (every expense, every
 * member, every settlement suggestion) and until now they acknowledged nothing
 * until their `click` handler produced a navigation. Consistency matters as
 * much as the feedback itself: if two things look equally tappable, they must
 * behave the same way when tapped.
 *
 * The compression is scaled down for big surfaces — a full-width row shrinking
 * 3% travels far more pixels than a 44px button doing the same, and reads as
 * the row lurching rather than depressing.
 *
 * **This component is usually a middleman, so it must never eat a prop.** It is
 * typically wrapped around a menu trigger, which means the props reaching it
 * belong to that trigger — including the `onPointerDown` Radix uses to open the
 * menu. Spreading our own pointer handlers over those replaced them outright
 * and silently killed every row-tap menu on mobile. Compose, never overwrite.
 */
export function Pressable({
  asChild = false,
  scale = 0.985,
  disabled = false,
  className,
  style,
  children,
  ...rest
}: {
  asChild?: boolean;
  scale?: number;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLElement>) {
  const { pressProps, pressStyle } = usePressable({ scale, disabled });
  const Comp = asChild ? Slot : 'div';

  return (
    <Comp
      {...rest}
      onPointerDown={compose(pressProps.onPointerDown, rest.onPointerDown)}
      onPointerMove={compose(pressProps.onPointerMove, rest.onPointerMove)}
      onPointerUp={compose(pressProps.onPointerUp, rest.onPointerUp)}
      onPointerCancel={compose(pressProps.onPointerCancel, rest.onPointerCancel)}
      onPointerLeave={compose(pressProps.onPointerLeave, rest.onPointerLeave)}
      className={className}
      // Transform and transition both come from `pressStyle`. Putting the
      // transition in a class here would collide with the `transition-colors`
      // most of these rows already carry: `tailwind-merge` resolves those as one
      // group and keeps only the last, silently dropping the compression.
      style={{ ...style, ...pressStyle }}
    >
      {children}
    </Comp>
  );
}
