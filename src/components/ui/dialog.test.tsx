// @vitest-environment jsdom
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { IntlProvider } from 'use-intl';
import messages from '../../../messages/en.json';
import { Dialog } from './dialog';

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <IntlProvider locale="en" messages={messages}>
      <button type="button" onClick={() => setOpen(true)}>
        open
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Confirm">
        <p>body</p>
      </Dialog>
    </IntlProvider>
  );
}

/** jsdom reports both as 0, so fake a scrollbar by widening the window. */
function fakeScrollbar(width: number) {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: document.documentElement.clientWidth + width,
  });
}

afterEach(() => {
  document.body.style.overflow = '';
  document.body.style.paddingRight = '';
});

describe('Dialog scroll lock', () => {
  it('locks the body while open', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'open' }));
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('replaces the scrollbar with padding so the page does not shift', async () => {
    fakeScrollbar(15);
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'open' }));

    // Hiding overflow reclaims the scrollbar's width; without compensation the
    // viewport widens and every centred element jumps sideways.
    expect(document.body.style.paddingRight).toBe('15px');
  });

  it('restores the body on close', async () => {
    fakeScrollbar(15);
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'open' }));
    await user.keyboard('{Escape}');

    expect(document.body.style.overflow).toBe('');
    expect(document.body.style.paddingRight).toBe('');
  });

  it('adds no padding when the scrollbar is an overlay', async () => {
    fakeScrollbar(0);
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'open' }));
    expect(document.body.style.paddingRight).toBe('');
  });
});
