import { describe, expect, it } from 'vitest';
import {
  SPRING,
  VelocityTracker,
  isSpringAtRest,
  project,
  rubberband,
  stepSpring,
  type SpringConfig,
} from './springs';

/** Run a spring to rest, returning the trajectory and the frames it took. */
function settle(
  from: number,
  to: number,
  config: SpringConfig = SPRING.ui,
  velocity = 0,
  fps = 60,
) {
  let state = { value: from, velocity };
  const trace = [from];
  for (let i = 0; i < 600; i++) {
    state = stepSpring(state, to, config, 1 / fps);
    trace.push(state.value);
    if (isSpringAtRest(state, to)) break;
  }
  return { trace, frames: trace.length, final: state };
}

describe('stepSpring', () => {
  it('converges to the target', () => {
    const { final } = settle(0, 100);
    expect(final.value).toBeCloseTo(100, 0);
  });

  it('does not overshoot when critically damped', () => {
    // damping 1.0 is the house default precisely because an interface element
    // that merely appeared has no momentum to justify a bounce.
    const { trace } = settle(0, 100, SPRING.ui);
    expect(Math.max(...trace)).toBeLessThanOrEqual(100.5);
  });

  it('overshoots when underdamped', () => {
    // The sheet spring is deliberately springy: the user's flick put the
    // momentum there, so the surface should carry past and settle back.
    const { trace } = settle(0, 100, SPRING.sheet);
    expect(Math.max(...trace)).toBeGreaterThan(100);
  });

  it('reaches the target faster with a shorter response', () => {
    const slow = settle(0, 100, { damping: 1, response: 0.6 });
    const fast = settle(0, 100, { damping: 1, response: 0.2 });
    expect(fast.frames).toBeLessThan(slow.frames);
  });

  it('produces the same trajectory at 60Hz and 120Hz', () => {
    // Sub-stepping exists for this: explicit integration at a fixed 60Hz gains
    // energy on stiff springs, so a 120Hz display would animate differently
    // from a 60Hz one.
    const at60 = settle(0, 100, SPRING.sheet, 0, 60);
    const at120 = settle(0, 100, SPRING.sheet, 0, 120);
    // Compare at equal elapsed time rather than equal frame index.
    const sampleAt = (t: number, trace: number[], fps: number) =>
      trace[Math.min(Math.round(t * fps), trace.length - 1)]!;
    for (const t of [0.05, 0.1, 0.2, 0.3]) {
      expect(sampleAt(t, at60.trace, 60)).toBeCloseTo(sampleAt(t, at120.trace, 120), 0);
    }
  });

  it('carries initial velocity into the motion', () => {
    const thrown = settle(0, 100, SPRING.momentum, 800);
    const dropped = settle(0, 100, SPRING.momentum, 0);
    // A surface released mid-flick must continue at the finger's speed; if it
    // restarted from zero there would be a visible seam at the release.
    expect(thrown.trace[1]!).toBeGreaterThan(dropped.trace[1]!);
  });

  it('survives a long frame without exploding', () => {
    // A backgrounded tab resumes with a multi-second delta.
    const state = stepSpring({ value: 0, velocity: 0 }, 100, SPRING.sheet, 5);
    expect(Number.isFinite(state.value)).toBe(true);
    expect(Math.abs(state.value)).toBeLessThan(200);
  });

  it('re-targets from the presentation value, not the target', () => {
    // Interruption: grab the element mid-flight and send it somewhere else.
    let state = { value: 0, velocity: 0 };
    for (let i = 0; i < 10; i++) state = stepSpring(state, 100, SPRING.ui, 1 / 60);
    const caught = state.value;
    expect(caught).toBeGreaterThan(0);
    expect(caught).toBeLessThan(100);

    // Continuing toward a new target must start from where it visibly is.
    const next = stepSpring(state, 0, SPRING.ui, 1 / 60);
    expect(Math.abs(next.value - caught)).toBeLessThan(5);
  });
});

describe('project', () => {
  it('projects further for faster flicks', () => {
    expect(project(1000)).toBeGreaterThan(project(500));
  });

  it('projects backwards for negative velocity', () => {
    expect(project(-1000)).toBeLessThan(0);
  });

  it('is zero at rest', () => {
    expect(project(0)).toBe(0);
  });

  it('lets a fast flick clear a threshold a slow drag would not', () => {
    // The whole point of projecting: decide on where the gesture is *going*,
    // not where the finger happened to stop.
    const releasedAt = 100;
    const threshold = 300;
    expect(releasedAt + project(50)).toBeLessThan(threshold);
    expect(releasedAt + project(1200)).toBeGreaterThan(threshold);
  });

  it('travels less with a snappier deceleration rate', () => {
    expect(project(1000, 0.99)).toBeLessThan(project(1000, 0.998));
  });
});

describe('rubberband', () => {
  it('resists progressively rather than stopping hard', () => {
    const small = rubberband(10, 800);
    const large = rubberband(100, 800);
    // Ten times the pull must not give ten times the travel.
    expect(large).toBeGreaterThan(small);
    expect(large).toBeLessThan(small * 10);
  });

  it('never fully stops following the finger', () => {
    // A frozen surface reads as broken; it must keep moving, just less.
    expect(rubberband(500, 800)).toBeGreaterThan(rubberband(400, 800));
  });

  it('stays well under the raw overshoot', () => {
    expect(rubberband(200, 800)).toBeLessThan(200);
  });

  it('is symmetric about zero', () => {
    expect(rubberband(-50, 800)).toBeCloseTo(-rubberband(50, 800), 6);
  });

  it('handles a zero dimension without dividing by zero', () => {
    expect(rubberband(50, 0)).toBe(0);
  });
});

describe('VelocityTracker', () => {
  it('measures a steady drag', () => {
    const tracker = new VelocityTracker();
    tracker.reset(0, 0);
    for (let t = 16; t <= 100; t += 16) tracker.add(t, t); // 1px per ms
    expect(tracker.velocity(100)).toBeCloseTo(1000, -1);
  });

  it('reports direction via sign', () => {
    const tracker = new VelocityTracker();
    tracker.reset(500, 0);
    for (let t = 16; t <= 100; t += 16) tracker.add(500 - t, t);
    expect(tracker.velocity(100)).toBeLessThan(0);
  });

  it('returns zero when the pointer never moved', () => {
    const tracker = new VelocityTracker();
    tracker.reset(42, 0);
    tracker.add(42, 50);
    expect(tracker.velocity(50)).toBe(0);
  });

  it('returns zero from a single sample', () => {
    const tracker = new VelocityTracker();
    tracker.reset(10, 0);
    expect(tracker.velocity(0)).toBe(0);
  });

  it('ignores stale samples outside the window', () => {
    // A finger that sprints and then rests before lifting has released at
    // rest — reporting the earlier sprint would fling a sheet the user
    // deliberately stopped.
    const tracker = new VelocityTracker(100);
    tracker.reset(0, 0);
    for (let t = 10; t <= 50; t += 10) tracker.add(t * 10, t); // fast
    for (let t = 60; t <= 300; t += 10) tracker.add(500, t); // then still
    expect(Math.abs(tracker.velocity(300))).toBeLessThan(100);
  });
});
