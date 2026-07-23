/**
 * Card themes. Each theme is a tiny module — adding one is a perfect first PR.
 */
import { catppuccin } from './catppuccin.js';
import { dark } from './dark.js';
import { dracula } from './dracula.js';
import { gruvbox } from './gruvbox.js';
import { light } from './light.js';
import { nord } from './nord.js';
import { solarizedDark } from './solarized-dark.js';
import { solarizedLight } from './solarized-light.js';

export interface CardTheme {
  name: string;
  /** Page background. */
  bg: string;
  /** Stat panel background. */
  panel: string;
  /** Primary text. */
  fg: string;
  /** Secondary text. */
  muted: string;
  /** Highlight color for the big numbers. */
  accent: string;
}

export const themes: Record<string, CardTheme> = {
  catppuccin,
  dark,
  dracula,
  gruvbox,
  light,
  nord,
  'solarized-dark': solarizedDark,
  'solarized-light': solarizedLight,
};
