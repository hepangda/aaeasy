// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Checkbox } from './checkbox';
import { NumericInput } from './numeric-input';

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

describe('NumericInput (desktop keyboard path)', () => {
  it('drops characters that are not digits or a decimal point', async () => {
    const user = userEvent.setup();
    render(<NumericInput aria-label="Amount" keypadTitle="Amount" />);

    const field = screen.getByLabelText('Amount');
    await user.type(field, '12a.b3元');
    expect(field).toHaveValue('12.3');
  });

  it('keeps a single decimal point and clamps the fraction to the precision', async () => {
    const user = userEvent.setup();
    render(<NumericInput aria-label="Amount" keypadTitle="Amount" precision={2} />);

    const field = screen.getByLabelText('Amount');
    await user.type(field, '1.2.345');
    expect(field).toHaveValue('1.23');
  });

  it('rejects a decimal point entirely in integer mode', async () => {
    const user = userEvent.setup();
    render(<NumericInput aria-label="Shares" keypadTitle="Shares" mode="integer" />);

    const field = screen.getByLabelText('Shares');
    await user.type(field, '2.5');
    expect(field).toHaveValue('25');
  });

  it('keeps a leading minus only when negatives are allowed', async () => {
    const user = userEvent.setup();
    render(<NumericInput aria-label="Extra" keypadTitle="Extra" allowNegative />);
    const allowed = screen.getByLabelText('Extra');
    await user.type(allowed, '-5');
    expect(allowed).toHaveValue('-5');

    render(<NumericInput aria-label="Plain" keypadTitle="Plain" />);
    const plain = screen.getByLabelText('Plain');
    await user.type(plain, '-5');
    expect(plain).toHaveValue('5');
  });
});
