// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Checkbox } from './checkbox';

describe('Checkbox', () => {
  it('exposes a 44px touch target around the visual box', () => {
    const { container } = render(<Checkbox aria-label="Include" />);
    // The wrapper carries the hit area; the drawn box stays visually small.
    expect(container.querySelector('.size-11')).toBeInTheDocument();
    expect(container.querySelector('.size-5')).toBeInTheDocument();
  });

  it('toggles when the label text is clicked', async () => {
    const user = userEvent.setup();
    render(<Checkbox label="Include Yuki" />);

    const box = screen.getByRole('checkbox');
    expect(box).not.toBeChecked();

    await user.click(screen.getByText('Include Yuki'));
    expect(box).toBeChecked();
  });

  it('forwards disabled state', () => {
    render(<Checkbox label="Locked" disabled />);
    expect(screen.getByRole('checkbox')).toBeDisabled();
  });
});
