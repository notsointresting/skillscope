import type { CardTheme } from './index.js';

// Ethan Schoonover's Solarized dark palette: base03 background, base02 panel,
// base1 body text, base01 for the muted line, and blue as the accent — it reads
// brighter against base03 than cyan does, so the big numbers carry.
export const solarizedDark: CardTheme = {
  name: 'solarized-dark',
  bg: '#002b36',
  panel: '#073642',
  fg: '#93a1a1',
  muted: '#586e75',
  accent: '#268bd2',
};
