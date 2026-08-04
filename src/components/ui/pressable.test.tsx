// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Slot } from '@radix-ui/react-slot';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './dropdown-menu';
import { Pressable } from './pressable';

describe('Pressable', () => {
  it('does not swallow a parent pointer handler', async () => {
    // Pressable is nearly always a middleman between a trigger and its element.
    // Spreading its own pointer handlers over the incoming ones replaced them,
    // which is how every row-tap menu on mobile stopped opening.
    const parentDown = vi.fn();
    render(
      <Slot onPointerDown={parentDown}>
        <Pressable asChild>
          <button type="button">row</button>
        </Pressable>
      </Slot>,
    );

    await userEvent.pointer({ target: screen.getByRole('button'), keys: '[MouseLeft>]' });
    expect(parentDown).toHaveBeenCalled();
  });

  it('keeps a wrapped dropdown trigger working', async () => {
    // The real shape from the expense/member/settlement lists: tapping the row
    // opens its action menu. Radix opens on pointer-down, so this only passes
    // if the trigger's own handler survived.
    const user = userEvent.setup();
    render(
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Pressable asChild scale={0.985}>
            <button type="button">row</button>
          </Pressable>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Edit</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    await user.click(screen.getByRole('button', { name: 'row' }));
    expect(await screen.findByRole('menuitem', { name: 'Edit' })).toBeInTheDocument();
  });

  it('still applies its own press feedback', async () => {
    render(
      <Pressable asChild scale={0.9}>
        <button type="button">row</button>
      </Pressable>,
    );

    const button = screen.getByRole('button');
    await userEvent.pointer({ target: button, keys: '[MouseLeft>]' });
    expect(button.style.transform).toBe('scale(0.9)');
  });

  it('transitions transform and colour together', () => {
    // The transition has to live inline alongside the transform, or
    // tailwind-merge resolves it against the row's own `transition-colors` and
    // drops one of them. Since an inline transition-property replaces the
    // class's outright, it must also carry the colour properties.
    render(
      <Pressable asChild>
        <button type="button">row</button>
      </Pressable>,
    );

    const style = screen.getByRole('button').style;
    expect(style.transitionProperty).toContain('transform');
    expect(style.transitionProperty).toContain('background-color');
  });
});
