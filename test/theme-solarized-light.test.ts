import { describe, expect, it } from 'vitest';

import { themes } from '../src/render/card/themes/index.js';

describe('solarized-light theme', () => {
  it('is registered with its palette', () => {
    const theme = themes['solarized-light'];
    expect(theme?.name).toBe('solarized-light');
    expect(theme?.accent).toBe('#268bd2');
    for (const value of Object.values(theme ?? {})) {
      if (value !== 'solarized-light') expect(value).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
