// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button } from '@/components/ui/button';

/**
 * Smoke test for the component-testing harness itself: jsdom environment,
 * React Testing Library rendering, and jest-dom matchers. If this fails, the
 * problem is the setup, not the component.
 */
describe('component test harness', () => {
  it('renders a component and applies jest-dom matchers', () => {
    render(<Button>Save</Button>);

    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toBeInTheDocument();
    expect(button).toBeEnabled();
  });

  it('reflects variant props in the class list', () => {
    render(<Button variant="destructive">Delete</Button>);

    expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass('bg-destructive');
  });
});
