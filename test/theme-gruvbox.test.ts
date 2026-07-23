import { describe, expect, it } from 'vitest';

import { themes } from '../src/render/card/themes/index.js';

describe('gruvbox theme', () => {
  it('is registered with its palette', () => {
    const theme = themes['gruvbox'];
    expect(theme?.name).toBe('gruvbox');
    expect(theme?.accent).toBe('#fabd2f');
    for (const value of Object.values(theme ?? {})) {
      if (value !== 'gruvbox') expect(value).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
