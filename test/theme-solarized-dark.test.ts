import { describe, expect, it } from 'vitest';

import { themes } from '../src/render/card/themes/index.js';

describe('solarized-dark theme', () => {
  it('is registered with its palette', () => {
    const theme = themes['solarized-dark'];
    expect(theme?.name).toBe('solarized-dark');
    expect(theme?.bg).toBe('#002b36');
    expect(theme?.accent).toBe('#268bd2');
    for (const value of Object.values(theme ?? {})) {
      if (value !== 'solarized-dark') expect(value).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
