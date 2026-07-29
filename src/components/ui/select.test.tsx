// @vitest-environment jsdom
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Select } from './select';

function Options() {
  return (
    <>
      <option value="a">Alpha</option>
      <option value="b">Bravo</option>
      <option value="c" disabled>
        Charlie
      </option>
    </>
  );
}

describe('Select', () => {
  it('shows the selected label without opening the platform picker', async () => {
    render(
      <Select value="b" onChange={() => {}}>
        <Options />
      </Select>,
    );
    // A styled trigger, not a bare <select> the OS would take over.
    expect(screen.getByRole('button')).toHaveTextContent('Bravo');
  });

  it('keeps a real select in the DOM for form semantics', () => {
    const { container } = render(
      <Select name="pick" value="a" onChange={() => {}}>
        <Options />
      </Select>,
    );
    const native = container.querySelector('select')!;
    expect(native).toHaveAttribute('name', 'pick');
    expect(native).toHaveValue('a');
  });

  it('reports the chosen value through onChange', async () => {
    const user = userEvent.setup();
    const seen: string[] = [];
    render(
      <Select value="a" onChange={(event) => seen.push(event.target.value)}>
        <Options />
      </Select>,
    );

    await user.click(screen.getByRole('button'));
    await user.click(screen.getByRole('option', { name: /Bravo/ }));

    // Read during the handler: React restores a controlled input's value once
    // the event has been dispatched, so inspecting the mock afterwards would
    // see the prop value rather than what the user picked.
    expect(seen).toEqual(['b']);
  });

  it('updates on its own when uncontrolled', async () => {
    const user = userEvent.setup();
    render(
      <Select defaultValue="a">
        <Options />
      </Select>,
    );

    await user.click(screen.getByRole('button'));
    await user.click(screen.getByRole('option', { name: /Bravo/ }));

    expect(screen.getByRole('button')).toHaveTextContent('Bravo');
  });

  it('tracks a controlled value', async () => {
    function Controlled() {
      const [value, setValue] = useState('a');
      return (
        <Select value={value} onChange={(event) => setValue(event.target.value)}>
          <Options />
        </Select>
      );
    }
    const user = userEvent.setup();
    render(<Controlled />);

    await user.click(screen.getByRole('button'));
    await user.click(screen.getByRole('option', { name: /Bravo/ }));

    expect(screen.getByRole('button')).toHaveTextContent('Bravo');
  });

  it('ignores disabled options', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Select value="a" onChange={onChange}>
        <Options />
      </Select>,
    );

    await user.click(screen.getByRole('button'));
    await user.click(screen.getByRole('option', { name: /Charlie/ }));

    expect(onChange).not.toHaveBeenCalled();
  });

  it('gives every option a 44px touch target', async () => {
    const user = userEvent.setup();
    render(
      <Select value="a" onChange={() => {}}>
        <Options />
      </Select>,
    );

    await user.click(screen.getByRole('button'));
    for (const option of screen.getAllByRole('option')) {
      expect(option.className).toContain('min-h-11');
    }
  });

  it('floats the listbox above the page instead of displacing it', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <Select value="a" onChange={() => {}}>
        <Options />
      </Select>,
    );

    await user.click(screen.getByRole('button'));
    const listbox = screen.getByRole('listbox');

    // Rendered through a portal, so an ancestor with `overflow: hidden` can't
    // clip it and the list can't push sibling content out of the way.
    expect(container.contains(listbox)).toBe(false);
    expect(document.body.contains(listbox)).toBe(true);
    expect(getComputedStyle(listbox).position).toBe('absolute');
  });

  it('opens with the keyboard and closes on Escape', async () => {
    const user = userEvent.setup();
    render(
      <Select value="a" onChange={() => {}}>
        <Options />
      </Select>,
    );

    const trigger = screen.getByRole('button');
    trigger.focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
