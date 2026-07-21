/**
 * The wrapped card. Rendering is pure string-building, so most cases run on
 * `renderCard` directly; one test drives the real CLI over the fixtures.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { compact, longestStreak, renderCard, type CardStats } from '../src/render/card/card.js';
import { themes } from '../src/render/card/themes/index.js';
import { run } from '../src/cli.js';

const dark = themes['dark']!;

const base: CardStats = {
  period: 'All time',
  sessions: 172,
  tokens: 46_700_000,
  topSkill: { name: 'superpowers', fires: 311 },
  topAgent: { name: 'Explore', fires: 45 },
  rarestSkill: { name: 'obscure-skill', fires: 1 },
  installed: 583,
  dead: 555,
  streak: 9,
};

describe('longestStreak', () => {
  it('is 0 with no days and 1 with any lone day', () => {
    expect(longestStreak([])).toBe(0);
    expect(longestStreak(['2026-07-01'])).toBe(1);
  });

  it('finds the longest consecutive run across gaps and duplicates', () => {
    expect(
      longestStreak([
        '2026-07-01',
        '2026-07-02',
        '2026-07-02',
        '2026-07-04',
        '2026-07-05',
        '2026-07-06',
      ]),
    ).toBe(3);
  });

  it('crosses a month boundary', () => {
    expect(longestStreak(['2026-06-30', '2026-07-01'])).toBe(2);
  });
});

describe('compact', () => {
  it('scales into k / M / B', () => {
    expect(compact(999)).toBe('999');
    expect(compact(1_500)).toBe('1.5k');
    expect(compact(171_234_567)).toBe('171.2M');
    expect(compact(2_500_000_000)).toBe('2.5B');
  });
});

describe('renderCard', () => {
  it('renders the happy path with every stat present', () => {
    const svg = renderCard(base, dark);
    expect(svg).toContain('<svg xmlns');
    expect(svg).toContain('superpowers');
    expect(svg).toContain('Explore');
    expect(svg).toContain('obscure-skill');
    expect(svg).toContain('555 of 583 installed never fired');
    expect(svg).toContain('9-day streak');
  });

  it('renders a friendly card with zero data', () => {
    const svg = renderCard(
      { period: 'All time', sessions: 0, tokens: 0, installed: 0, dead: 0, streak: 0 },
      dark,
    );
    expect(svg).toContain('No activity in this period yet');
    expect(svg).toContain('nothing installed yet');
    expect(svg).not.toContain('-day streak');
  });

  it('survives huge numbers and stays compact', () => {
    const svg = renderCard({ ...base, tokens: 987_654_321_000, sessions: 12_345 }, dark);
    expect(svg).toContain('987.7B');
    expect(svg).toContain('12.3k');
  });

  it('escapes and truncates hostile skill names', () => {
    const svg = renderCard(
      {
        ...base,
        topSkill: { name: '<script>&"quote"</script>-with-an-extremely-long-name', fires: 2 },
      },
      dark,
    );
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;&amp;&quot;quote&quot;');
    expect(svg).toContain('…');
  });

  it('renders every theme without leaving placeholders', () => {
    for (const theme of Object.values(themes)) {
      const svg = renderCard(base, theme);
      expect(svg).toContain(theme.bg);
      expect(svg).not.toContain('undefined');
    }
  });
});

describe('skillscope wrapped via the CLI', () => {
  const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
  const previous = process.env['CLAUDE_CONFIG_DIR'];
  let tmp: string;
  let out: string[];
  let err: string[];

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'skillscope-'));
    process.env['SKILLSCOPE_CACHE_DIR'] = path.join(tmp, 'cache');
    out = [];
    err = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      out.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      err.push(String(chunk));
      return true;
    });
    process.env['CLAUDE_CONFIG_DIR'] = FIXTURES;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env['SKILLSCOPE_CACHE_DIR'];
    rmSync(tmp, { recursive: true, force: true });
    if (previous === undefined) delete process.env['CLAUDE_CONFIG_DIR'];
    else process.env['CLAUDE_CONFIG_DIR'] = previous;
  });

  it('writes an SVG for the whole history', async () => {
    const file = path.join(tmp, 'card.svg');
    expect(await run(['wrapped', '--out', file])).toBe(0);
    const svg = readFileSync(file, 'utf8');
    expect(svg).toContain('<svg xmlns');
    expect(svg).toContain('All time');
    expect(out.join('')).toContain('card.svg');
  });

  it('scopes the card to one month and labels it', async () => {
    const file = path.join(tmp, 'month.svg');
    expect(await run(['wrapped', '--month', '2026-07', '--out', file])).toBe(0);
    expect(readFileSync(file, 'utf8')).toContain('July 2026');
  });

  it('rejects a malformed --month', async () => {
    expect(await run(['wrapped', '--month', 'last-tuesday'])).toBe(2);
    expect(err.join('')).toContain('--month expects YYYY-MM');
  });

  it('rejects an unknown theme with the list of real ones', async () => {
    expect(await run(['wrapped', '--theme', 'vaporwave'])).toBe(2);
    expect(err.join('')).toContain('Unknown theme: vaporwave');
    expect(err.join('')).toContain('dark');
  });
});
