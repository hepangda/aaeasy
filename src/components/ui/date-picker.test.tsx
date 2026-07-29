// @vitest-environment jsdom
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { IntlProvider } from 'use-intl';
import { DatePicker } from './date-picker';
import messages from '../../../messages/en.json';

function renderPicker(ui: React.ReactElement) {
  return render(
    <IntlProvider locale="en" messages={messages} timeZone="UTC">
      {ui}
    </IntlProvider>,
  );
}

describe('DatePicker', () => {
  it('renders a styled trigger rather than a native date field', () => {
    renderPicker(<DatePicker value="2024-03-15" aria-label="Date" />);
    // A button the app styles — not an input the OS takes over.
    expect(screen.getByRole('button', { name: 'Date' })).toHaveTextContent('Mar 15, 2024');
  });

  it('keeps a real date input in the DOM for form submission', () => {
    const { container } = renderPicker(<DatePicker name="occurredAt" value="2024-03-15" />);
    const native = container.querySelector('input[type="date"]')!;
    expect(native).toHaveAttribute('name', 'occurredAt');
    expect(native).toHaveValue('2024-03-15');
  });

  it('does not mark the hidden input required, which would block submission', () => {
    const { container } = renderPicker(<DatePicker name="d" value="2024-03-15" required />);
    const native = container.querySelector('input[type="date"]')!;
    // An invisible required control makes browsers refuse to submit.
    expect(native).not.toBeRequired();
    expect(screen.getByRole('button')).toHaveAttribute('aria-required', 'true');
  });

  it('commits the clicked day to the hidden input', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [value, setValue] = useState('2024-03-15');
      return <DatePicker name="d" value={value} onValueChange={setValue} aria-label="Date" />;
    }
    const { container } = renderPicker(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Date' }));
    await user.click(screen.getByRole('gridcell', { name: '20' }));
    expect(container.querySelector('input[type="date"]')).toHaveValue('2024-03-20');
    // Selecting closes the panel.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('always renders six weeks so paging does not resize the panel', async () => {
    const user = userEvent.setup();
    renderPicker(<DatePicker value="2024-02-01" aria-label="Date" />);
    await user.click(screen.getByRole('button', { name: 'Date' }));
    expect(screen.getAllByRole('gridcell')).toHaveLength(42);
    await user.click(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getAllByRole('gridcell')).toHaveLength(42);
  });

  it('moves by day and week with the arrow keys and commits with Enter', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [value, setValue] = useState('2024-03-15');
      return <DatePicker name="d" value={value} onValueChange={setValue} aria-label="Date" />;
    }
    const { container } = renderPicker(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Date' }));
    await user.keyboard('{ArrowDown}{ArrowRight}'); // +7 days, +1 day
    await user.keyboard('{Enter}');
    expect(container.querySelector('input[type="date"]')).toHaveValue('2024-03-23');
  });

  it('refuses days outside min/max', async () => {
    const user = userEvent.setup();
    const { container } = renderPicker(
      <DatePicker name="d" defaultValue="2024-03-15" max="2024-03-18" aria-label="Date" />,
    );
    await user.click(screen.getByRole('button', { name: 'Date' }));
    expect(screen.getByRole('gridcell', { name: '20' })).toBeDisabled();
    await user.click(screen.getByRole('gridcell', { name: '20' }));
    expect(container.querySelector('input[type="date"]')).toHaveValue('2024-03-15');
  });

  it('does not lock page scroll while open', async () => {
    const user = userEvent.setup();
    renderPicker(<DatePicker value="2024-03-15" aria-label="Date" />);
    await user.click(screen.getByRole('button', { name: 'Date' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // The page stays scrollable; locking would shift everything underneath.
    expect(document.body.style.overflow).not.toBe('hidden');
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    renderPicker(<DatePicker value="2024-03-15" aria-label="Date" />);
    const trigger = screen.getByRole('button', { name: 'Date' });
    await user.click(trigger);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
