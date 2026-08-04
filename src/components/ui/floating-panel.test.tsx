// @vitest-environment jsdom
import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, beforeAll } from 'vitest';
import { FloatingPanel } from './floating-panel';

/**
 * jsdom reports every element as 0x0. The origin logic exists precisely to
 * distinguish "not measured yet" from "measured", so the harness must be able
 * to say "this one now has a size".
 *
 * The size has to be reported for the *panel* element, which is the portal root
 * FloatingPanel creates itself — identified here by its role, since the test
 * cannot put an attribute on an element it doesn't render.
 */
function giveSize(width: number, height: number) {
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.getAttribute('role') === 'dialog' ? width : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.getAttribute('role') === 'dialog' ? height : 0;
    },
  });
}

/**
 * The anchor is attached with a callback ref, so it is available on the very
 * first commit — this is exactly how `Select` drives the panel, and it is what
 * makes the ordering bug reachable: the positioning effect then runs before the
 * portal has mounted, so the panel measures 0x0.
 *
 * Handing the anchor over in a `useEffect` instead (the obvious way to write
 * this harness) delays it by one commit, by which point the panel exists and
 * the bug is invisible.
 */
function Harness({ anchorRect }: { anchorRect: Partial<DOMRect> }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  return (
    <>
      <button
        type="button"
        ref={(node) => {
          if (!node) return;
          node.getBoundingClientRect = () =>
            ({
              left: 0,
              top: 0,
              right: 0,
              bottom: 0,
              width: 0,
              height: 0,
              ...anchorRect,
            }) as DOMRect;
          setAnchor(node);
        }}
      >
        trigger
      </button>
      <FloatingPanel open anchor={anchor} ariaLabel="menu" align="start">
        <div>content</div>
      </FloatingPanel>
    </>
  );
}

beforeAll(() => {
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 });
});

describe('FloatingPanel transform origin', () => {
  it('grows out of the trigger, not from its own top-left corner', async () => {
    giveSize(200, 100);
    // Trigger centred at x=300, sitting near the top of the viewport.
    render(<Harness anchorRect={{ left: 250, right: 350, width: 100, top: 10, bottom: 40 }} />);

    const panel = await screen.findByRole('dialog');

    await waitFor(() => {
      // The regression: origin stayed at `0px 0px` because the panel was
      // measured before it existed, so it flew in from its own corner.
      expect(panel.style.transformOrigin).not.toBe('0px 0px');
      expect(panel.style.transformOrigin).toBeTruthy();
    });

    // Panel is left-aligned to the trigger (left=250), trigger centre is 300,
    // so the origin should sit 50px into the panel — under the control.
    expect(panel.style.transformOrigin).toBe('50px 0px');
  });

  it('grows from its bottom edge when flipped above the trigger', async () => {
    giveSize(200, 100);
    // Trigger near the bottom: no room below, so the panel flips up and must
    // grow from the edge nearest the control.
    render(<Harness anchorRect={{ left: 250, right: 350, width: 100, top: 760, bottom: 790 }} />);

    const panel = await screen.findByRole('dialog');
    await waitFor(() => {
      expect(panel.style.transformOrigin).toBe('50px 100px');
    });
  });

  it('paints a panel that reports no size, once it has been positioned', () => {
    // Zero-size is not the same as unpositioned. jsdom reports every element as
    // 0x0, and a real panel can legitimately be empty — both are laid out
    // correctly and must be visible. Only the pre-mount commit, where the panel
    // node does not exist and `top`/`left` are still the off-screen fallback,
    // is withheld from the screen.
    giveSize(0, 0);
    const { baseElement } = render(
      <Harness anchorRect={{ left: 250, right: 350, width: 100, top: 10, bottom: 40 }} />,
    );

    const panel = baseElement.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(panel.style.visibility).toBe('visible');
    expect(panel).toHaveAttribute('data-measured', 'true');
  });

  it('paints and animates as soon as it can be measured', async () => {
    giveSize(200, 100);
    render(<Harness anchorRect={{ left: 250, right: 350, width: 100, top: 10, bottom: 40 }} />);

    const panel = await screen.findByRole('dialog');
    await waitFor(() => {
      expect(panel.style.visibility).toBe('visible');
      // The animation is keyed off this, so it turns on in the same commit as
      // the real origin — never a frame apart.
      expect(panel).toHaveAttribute('data-measured', 'true');
    });
  });

  it('never transitions its own position', async () => {
    // The panel is placed with `top`/`left`, and before it is measured those
    // sit at an off-screen fallback. A CSS transition covering them therefore
    // eases the panel across ten thousand pixels on open — it visibly flies in
    // from outside the viewport. This is easy to reintroduce by accident:
    // `duration-*` / `ease-*` without a `transition-property` compile to
    // `transition: all`, which includes `top`.
    giveSize(200, 100);
    render(<Harness anchorRect={{ left: 250, right: 350, width: 100, top: 10, bottom: 40 }} />);

    const panel = await screen.findByRole('dialog');
    expect(panel.className).toContain('transition-none');
    // Any duration/easing must be scoped, so it can never apply on its own.
    for (const token of panel.className.split(/\s+/)) {
      if (/(^|:)duration-/.test(token) || /(^|:)ease-/.test(token)) {
        expect(token).toContain('data-[measured]:');
      }
    }
  });
});
