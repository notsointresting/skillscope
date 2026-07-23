import { describe, expect, it } from 'vitest';

import { themes } from '../src/render/card/themes/index.js';

describe('nord theme', () => {
  it('is registered with its palette', () => {
    const theme = themes['nord'];
    expect(theme?.name).toBe('nord');
    expect(theme?.accent).toBe('#88c0d0');
    for (const value of Object.values(theme ?? {})) {
      if (value !== 'nord') expect(value).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
