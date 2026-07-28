// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Skeleton, SkeletonList, SkeletonPage } from './skeleton';

describe('Skeleton', () => {
  it('is hidden from assistive tech', () => {
    const { container } = render(<Skeleton className="h-4 w-10" />);
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });

  it('respects reduced-motion preferences', () => {
    const { container } = render(<Skeleton />);
    expect(container.firstElementChild).toHaveClass('motion-reduce:animate-none');
  });

  it('marks list and page placeholders as busy status regions', () => {
    render(<SkeletonList rows={3} />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-busy', 'true');
  });

  it('renders the requested number of rows', () => {
    const { container } = render(<SkeletonList rows={4} />);
    // Each row is a direct child of the status container.
    expect(container.querySelector('[role="status"]')!.children).toHaveLength(4);
  });

  it('renders a page-shaped placeholder', () => {
    render(<SkeletonPage rows={2} />);
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
  });
});
