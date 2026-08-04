/**
 * The app's motion physics, in one place.
 *
 * Apple deliberately replaced the physics triplet (mass/stiffness/damping) with
 * two designer-facing parameters, and we use the same two:
 *
 *  - `damping`  — controls overshoot. 1.0 is critically damped (no bounce);
 *                 below 1.0 the value overshoots and oscillates.
 *  - `response` — how quickly the value reaches the target, in seconds. This is
 *                 *not* a duration: a spring has no fixed end time, its settle
 *                 time emerges from the parameters.
 *
 * House style: critically damped everywhere by default. Bounce is reserved for
 * motion the user's own gesture put momentum into — a flick, a throw, a drag
 * release. Overshoot on a menu that merely appeared reads as decoration;
 * overshoot on a card you threw reads as physics.
 */

export interface SpringConfig {
  /** 1 = critically damped (no overshoot). Lower = bouncier. */
  damping: number;
  /** Seconds to reach the target. Lower = snappier. */
  response: number;
}

export const SPRING = {
  /** Default for anything that isn't gesture-driven. */
  ui: { damping: 1, response: 0.35 },
  /** Repositioning an object on screen (Apple ships 1.0 / 0.4 for PiP). */
  move: { damping: 1, response: 0.4 },
  /** Drawers and sheets (Apple ships 0.8 / 0.3). */
  sheet: { damping: 0.8, response: 0.3 },
  /** Settling after a flick — the gesture supplied the momentum. */
  momentum: { damping: 0.8, response: 0.4 },
  /** Snappy affordances: press states, indicator bars. */
  press: { damping: 1, response: 0.22 },
} as const satisfies Record<string, SpringConfig>;

/** Below this the spring is visually at rest and we can stop stepping it. */
const REST_DISPLACEMENT = 0.01;
const REST_VELOCITY = 0.05;
/**
 * Clamp the integration step. A backgrounded tab resumes with a multi-second
 * delta, which would explode a stiff spring into a single enormous jump.
 */
const MAX_STEP_SECONDS = 1 / 30;

/**
 * Convert Apple's (damping, response) into the (stiffness, damping coefficient)
 * an integrator needs. `response` is the period of the undamped oscillation, so
 * omega = 2*PI / response.
 */
function coefficients({ damping, response }: SpringConfig): {
  stiffness: number;
  friction: number;
} {
  const omega = (2 * Math.PI) / response;
  return { stiffness: omega * omega, friction: 2 * damping * omega };
}

export interface SpringState {
  value: number;
  velocity: number;
}

/**
 * Advance a spring by `deltaSeconds` using semi-implicit Euler, sub-stepped so
 * the result is frame-rate independent. Explicit Euler at 60Hz visibly gains
 * energy on stiff springs; sub-stepping keeps a 120Hz display and a 60Hz one on
 * the same trajectory.
 */
export function stepSpring(
  state: SpringState,
  target: number,
  config: SpringConfig,
  deltaSeconds: number,
): SpringState {
  const { stiffness, friction } = coefficients(config);
  const step = 1 / 240;
  let remaining = Math.min(deltaSeconds, MAX_STEP_SECONDS);
  let { value, velocity } = state;

  while (remaining > 0) {
    const dt = Math.min(step, remaining);
    remaining -= dt;
    const acceleration = -stiffness * (value - target) - friction * velocity;
    velocity += acceleration * dt;
    value += velocity * dt;
  }

  return { value, velocity };
}

export function isSpringAtRest(state: SpringState, target: number): boolean {
  return (
    Math.abs(state.value - target) < REST_DISPLACEMENT && Math.abs(state.velocity) < REST_VELOCITY
  );
}

/**
 * Where a flick would come to rest, given its release velocity.
 *
 * This is Apple's projection function from the *Designing Fluid Interfaces*
 * sample code — exponential decay, not the physics-textbook `v^2 / 2a`. Use it
 * to pick the snap target *before* animating, so a small fast flick throws the
 * element the way a real one would, instead of snapping back to whatever
 * happened to be nearest at the moment the finger lifted.
 *
 * @param velocity px/s at release
 * @param deceleration 0.998 for a normal scroll feel, 0.99 for snappier
 */
export function project(velocity: number, deceleration = 0.998): number {
  return ((velocity / 1000) * deceleration) / (1 - deceleration);
}

/**
 * Progressive resistance past a boundary.
 *
 * A hard stop reads as "frozen"; resistance that grows the further you push
 * reads as "responsive, but there is nothing more here". Real things slow down
 * before they stop.
 *
 * @param overshoot how far past the bound the pointer has travelled
 * @param dimension the size of the surface being dragged
 */
export function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  if (dimension <= 0) return 0;
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

/**
 * A short history of pointer samples, used to recover release velocity.
 *
 * The last two `pointermove` events are not enough: they are noisy, and a
 * finger that pauses before lifting reports ~0 there even though the gesture
 * clearly had direction. Averaging over a short recent window is what makes the
 * hand-off between drag and animation invisible.
 */
export class VelocityTracker {
  private samples: { value: number; time: number }[] = [];

  constructor(private readonly windowMs = 100) {}

  reset(value: number, time: number): void {
    this.samples = [{ value, time }];
  }

  add(value: number, time: number): void {
    this.samples.push({ value, time });
    const cutoff = time - this.windowMs * 2;
    while (this.samples.length > 2 && this.samples[0]!.time < cutoff) this.samples.shift();
  }

  /** px/s over the recent window, or 0 if there isn't enough signal. */
  velocity(now: number): number {
    const recent = this.samples.filter((sample) => now - sample.time <= this.windowMs);
    const first = (recent.length >= 2 ? recent[0] : this.samples[0]) ?? null;
    const last = this.samples[this.samples.length - 1] ?? null;
    if (!first || !last) return 0;
    const elapsed = last.time - first.time;
    if (elapsed <= 0) return 0;
    return ((last.value - first.value) / elapsed) * 1000;
  }
}
