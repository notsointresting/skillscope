/**
 * Card themes. Each theme is a tiny module — adding one is a perfect first PR.
 */
import { dark } from './dark.js';
import { light } from './light.js';

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
  dark,
  light,
};
