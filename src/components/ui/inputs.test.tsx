// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Checkbox } from './checkbox';
import { Field } from './field';
import { Input } from './input';

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

describe('Field', () => {
  it('associates the label with the control', () => {
    render(<Field label="Title">{(props) => <Input {...props} defaultValue="Dinner" />}</Field>);
    expect(screen.getByLabelText('Title')).toHaveValue('Dinner');
  });

  it('wires aria-invalid and aria-describedby when an error is present', () => {
    render(
      <Field label="Amount" error="Must be a number">
        {(props) => <Input {...props} />}
      </Field>,
    );

    const input = screen.getByLabelText('Amount');
    expect(input).toHaveAttribute('aria-invalid', 'true');

    const error = screen.getByRole('alert');
    expect(error).toHaveTextContent('Must be a number');
    expect(input.getAttribute('aria-describedby')).toBe(error.id);
  });

  it('leaves aria-invalid off when valid', () => {
    render(
      <Field label="Amount" hint="Major units">
        {(props) => <Input {...props} />}
      </Field>,
    );

    const input = screen.getByLabelText('Amount');
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('hides the hint once an error takes over', () => {
    render(
      <Field label="Amount" hint="Major units" error="Required">
        {(props) => <Input {...props} />}
      </Field>,
    );
    expect(screen.queryByText('Major units')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Required');
  });
});
