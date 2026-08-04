// @vitest-environment jsdom
import { useState } from 'react';
import { render, screen, waitForElementToBeRemoved } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { BottomSheet } from './bottom-sheet';

function Harness({ onClose }: { onClose?: () => void } = {}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
      >
        open
      </button>
      <BottomSheet
        open={open}
        onClose={() => {
          setOpen(false);
          onClose?.();
        }}
        ariaLabel="Amount"
      >
        <button type="button">inside</button>
      </BottomSheet>
    </>
  );
}

describe('BottomSheet', () => {
  it('mounts offscreen and travels in', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'open' }));
    const panel = await screen.findByRole('dialog');

    // It must arrive along a path. Rendering it already in place would give the
    // user no cue about where it came from — or how to send it back.
    expect(panel).toBeInTheDocument();
  });

  it('stays mounted while leaving, then unmounts', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'open' }));
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');

    // Still on screen: the exit retraces the entrance rather than cutting.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await waitForElementToBeRemoved(() => screen.queryByRole('dialog'));
  });

  it('exposes a drag affordance', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'open' }));
    const panel = await screen.findByRole('dialog');

    // The grabber is how a first-time user learns the surface can be pulled.
    // It is decorative to assistive tech, which already has Escape.
    const grabber = panel.querySelector('[aria-hidden="true"]');
    expect(grabber).toBeTruthy();
  });

  it('allows vertical panning so the gesture is not swallowed by the browser', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'open' }));
    const panel = await screen.findByRole('dialog');

    expect(panel.className).toContain('touch-pan-y');
  });

  it('traps focus inside the sheet', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'open' }));
    const panel = await screen.findByRole('dialog');

    expect(panel.contains(document.activeElement)).toBe(true);
  });
});
