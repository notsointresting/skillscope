import { describe, expect, it } from 'vitest';

import { themes } from '../src/render/card/themes/index.js';

describe('catppuccin theme', () => {
  it('is registered with its palette', () => {
    const theme = themes['catppuccin'];
    expect(theme?.name).toBe('catppuccin');
    expect(theme?.accent).toBe('#cba6f7');
    for (const value of Object.values(theme ?? {})) {
      if (value !== 'catppuccin') expect(value).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
