// @vitest-environment jsdom
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { IntlProvider } from 'use-intl';
import messages from '../../../messages/en.json';
import { NumericKeypad } from './numeric-keypad';

function Harness({ initial = '' }: { initial?: string } = {}) {
  const [value, setValue] = useState(initial);
  return (
    <IntlProvider locale="en" messages={messages}>
      <output>{value}</output>
      <NumericKeypad
        open
        value={value}
        mode="decimal"
        precision={2}
        initiallySelected={false}
        onChange={setValue}
        onClose={() => {}}
        title="Amount"
      />
    </IntlProvider>
  );
}

/** The readout inside the sheet, which updates as keys are pressed. */
function draft() {
  return screen.getByRole('dialog').querySelector('.font-mono')!.textContent;
}

describe('NumericKeypad', () => {
  it('registers a digit on pointer-down, not on release', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const key = screen.getByRole('button', { name: '7' });
    await user.pointer({ target: key, keys: '[MouseLeft>]' }); // press, no release

    // A physical key registers when it goes down. On the app's most-tapped
    // control, waiting for release is where latency is felt most.
    expect(draft()).toBe('7');
  });

  it('does not double-register across a full press and release', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: '7' }));

    // pointerdown fires the handler and click must not fire it again.
    expect(draft()).toBe('7');
  });

  it('still works from the keyboard, which emits no pointer events', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    screen.getByRole('button', { name: '5' }).focus();
    await user.keyboard('{Enter}');

    expect(draft()).toBe('5');
  });

  it('builds a multi-digit value', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    for (const digit of ['1', '2', '3']) {
      await user.click(screen.getByRole('button', { name: digit }));
    }

    expect(draft()).toBe('123');
  });

  it('respects the precision limit', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    for (const key of ['1', '.', '2', '3', '4']) {
      await user.click(screen.getByRole('button', { name: key }));
    }

    // precision=2 — the fourth keystroke after the dot must be refused.
    expect(draft()).toBe('1.23');
  });

  it('deletes on backspace', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: '8' }));
    await user.click(screen.getByRole('button', { name: '9' }));
    await user.click(screen.getByRole('button', { name: /delete/i }));

    expect(draft()).toBe('8');
  });

  it('only commits to the field on confirm', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: '4' }));
    // Keystrokes stay local, so an abandoned edit leaves the field untouched.
    expect(screen.getByRole('status').textContent).toBe('');

    await user.click(screen.getByRole('button', { name: /confirm/i }));
    expect(screen.getByRole('status').textContent).toBe('4');
  });
});
