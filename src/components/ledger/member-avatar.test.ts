import { describe, expect, it } from 'vitest';
import { ledgerMemberColor } from './member-avatar';

/** WCAG relative luminance. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
  const channel = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastWithWhite(hex: string): number {
  return 1.05 / (luminance(hex) + 0.05);
}

describe('ledgerMemberColor', () => {
  it('is deterministic for a given member id', () => {
    const member = { id: 'abc123', color: null };
    expect(ledgerMemberColor(member)).toBe(ledgerMemberColor(member));
  });

  it('honours an explicit member colour', () => {
    expect(ledgerMemberColor({ id: 'x', color: '#123456' })).toBe('#123456');
  });

  it('only produces fallbacks that clear WCAG AA against white initials', () => {
    // The avatar draws white text on this background, so every reachable
    // colour must clear 4.5:1. An earlier palette shipped an amber at 2.51:1.
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      seen.add(ledgerMemberColor({ id: `member-${i}`, color: null }));
    }
    expect(seen.size).toBeGreaterThan(1);
    for (const color of seen) {
      expect(contrastWithWhite(color), `${color} contrast`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
