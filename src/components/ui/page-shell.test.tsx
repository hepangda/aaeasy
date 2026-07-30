// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PageShell } from './page-shell';

/**
 * The container is the thing that drifted: eleven pages hand-rolled it and
 * ended up with five max-widths and three padding ramps, so the content column
 * jumped when navigating. These assert the two invariants that matter — one
 * padding ramp for every page, and a width that matches the header bar.
 */
describe('PageShell', () => {
  function inner(container: HTMLElement) {
    return container.querySelector('section > div')!;
  }

  it('matches the header bar width so page content shares its left edge', () => {
    const { container } = render(<PageShell>x</PageShell>);
    expect(inner(container)).toHaveClass('max-w-6xl');
  });

  it('narrows for single-form pages without changing the padding ramp', () => {
    const { container } = render(<PageShell width="narrow">x</PageShell>);
    const el = inner(container);
    expect(el).toHaveClass('max-w-3xl');
    // Same horizontal rhythm as the default — only the measure changes.
    expect(el).toHaveClass('px-4', 'sm:px-6', 'lg:px-8');
  });

  it('uses one padding ramp shared with the header', () => {
    const { container } = render(<PageShell>x</PageShell>);
    expect(inner(container)).toHaveClass('px-4', 'sm:px-6', 'lg:px-8');
  });
});
