// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BrandMark } from './brand-mark';

describe('BrandMark', () => {
  it('is block-level so it does not sit on a text baseline', () => {
    // jsdom does not lay out, so this asserts the mechanism rather than the
    // pixels: an inline-level wrapper gets a line box, whose strut adds
    // descender space *below* the mark. That made the wrapping header link
    // 38.5px tall around 32px of content, and centring the link in the header
    // centred the phantom space too — putting the logo 3.25px above the
    // switcher, nav buttons and avatar it sits beside.
    const { container } = render(<BrandMark />);
    const root = container.firstElementChild!;
    expect(root).toHaveClass('flex');
    expect(root).not.toHaveClass('inline-flex');
  });

  it('keeps an accessible name when the wordmark is hidden', () => {
    render(<BrandMark showWordmark={false} />);
    expect(screen.getByText('AAEasy')).toHaveClass('sr-only');
  });
});
