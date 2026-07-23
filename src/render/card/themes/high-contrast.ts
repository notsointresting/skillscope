import type { CardTheme } from './index.js';

// An accessibility-first palette rather than an aesthetic one: every text token
// clears WCAG AAA (7:1) against BOTH the page background and the stat panel, so
// the card stays readable on a projector, in sunlight, or with low vision.
//
// Measured contrast ratios (vs bg / vs panel):
//   fg     #ffffff  21.00 / 17.04
//   muted  #d0d0d0  13.62 / 11.05
//   accent #ffd60a  14.88 / 12.07
//
// The amber accent is deliberate: it stays distinguishable under the common
// red-green colour-vision deficiencies, which a green or red accent would not.
export const highContrast: CardTheme = {
  name: 'high-contrast',
  bg: '#000000',
  panel: '#1c1c1c',
  fg: '#ffffff',
  muted: '#d0d0d0',
  accent: '#ffd60a',
};
