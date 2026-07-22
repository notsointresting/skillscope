/**
 * Each named theme is registered and exposes a complete CardTheme. The generic
 * "renders every theme" check lives in wrapped.test.ts; this pins the specific
 * accents so a palette can't silently regress.
 */
import { describe, expect, it } from 'vitest';

import { themes } from '../src/render/card/themes/index.js';

const HEX = /^#[0-9a-f]{6}$/;

describe('themes', () => {
  it('registers dracula with its palette', () => {
    const theme = themes['dracula'];
    expect(theme).toBeDefined();
    expect(theme?.name).toBe('dracula');
    expect(theme?.accent).toBe('#bd93f9');
    for (const value of Object.values(theme ?? {})) {
      if (value !== 'dracula') expect(value).toMatch(HEX);
    }
  });
});
