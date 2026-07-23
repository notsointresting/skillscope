import { describe, expect, it } from 'vitest';

import { themes } from '../src/render/card/themes/index.js';

/** WCAG 2.1 relative luminance of an `#rrggbb` colour. */
function luminance(hex: string): number {
  const channels = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

/** WCAG 2.1 contrast ratio between two `#rrggbb` colours, 1:1 to 21:1. */
function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const AAA = 7;

describe('high-contrast theme', () => {
  it('is registered with its palette', () => {
    const theme = themes['high-contrast'];
    expect(theme?.name).toBe('high-contrast');
    for (const value of Object.values(theme ?? {})) {
      if (value !== 'high-contrast') expect(value).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('clears WCAG AAA for every text token against the background and the panel', () => {
    const theme = themes['high-contrast'];
    expect(theme).toBeDefined();
    if (!theme) return;

    for (const token of ['fg', 'muted', 'accent'] as const) {
      expect(contrastRatio(theme[token], theme.bg)).toBeGreaterThanOrEqual(AAA);
      expect(contrastRatio(theme[token], theme.panel)).toBeGreaterThanOrEqual(AAA);
    }
  });

  it('is the highest-contrast theme available', () => {
    const theme = themes['high-contrast'];
    expect(theme).toBeDefined();
    if (!theme) return;

    const own = contrastRatio(theme.fg, theme.bg);
    for (const [name, other] of Object.entries(themes)) {
      if (name === 'high-contrast') continue;
      expect(own).toBeGreaterThan(contrastRatio(other.fg, other.bg));
    }
  });
});

describe('contrast helper', () => {
  it('matches the WCAG reference values', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 5);
  });
});
