/**
 * `--top <n>` caps component rows after sorting, identically in every format.
 * Driven off a synthetic Report (like sort.test.ts) so the row count is known.
 */
import { describe, expect, it } from 'vitest';

import type { ComponentUsage } from '../src/analyze/attribute.js';
import { componentView, report } from '../src/commands.js';
import type { Report } from '../src/load.js';

function usage(name: string, fires: number): ComponentUsage {
  return {
    kind: 'skill',
    name,
    fires,
    sessions: fires,
    projects: 1,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0, total: fires },
    overheadTokens: 0,
  };
}

function reportWith(used: ComponentUsage[]): Report {
  return {
    dirs: { root: '/x', exists: true },
    stats: { lines: 0, malformed: 0 },
    unknownTypes: [],
    used,
    untracked: [],
    dead: [],
    sessions: 0,
    projects: 0,
    activeDays: [],
    cost: {
      totals: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0, total: 0 },
      unattributed: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0, total: 0 },
      unlinkedSubagent: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0, total: 0 },
    },
  } as unknown as Report;
}

const four = (): Report =>
  reportWith([usage('a', 4), usage('b', 3), usage('c', 2), usage('d', 1)]);

const jsonNames = (out: string): string[] =>
  (JSON.parse(out) as { used: { name: string }[] }).used.map((r) => r.name);

describe('--top', () => {
  it('caps rows post-sort, keeping the highest-ranked', () => {
    const out = componentView(four(), 'skill', { format: 'json', sort: 'fires', top: 2 });
    expect(jsonNames(out)).toEqual(['a', 'b']);
  });

  it('caps after the sort, not before it', () => {
    // Sorted by name the first two are a, b; by fires ascending they would differ.
    const out = componentView(four(), 'skill', { format: 'json', sort: 'name', top: 3 });
    expect(jsonNames(out)).toEqual(['a', 'b', 'c']);
  });

  it('defaults to unlimited when omitted', () => {
    const out = componentView(four(), 'skill', { format: 'json', sort: 'fires' });
    expect(jsonNames(out)).toHaveLength(4);
  });

  it('is a no-op when n exceeds the row count', () => {
    const out = componentView(four(), 'skill', { format: 'json', sort: 'fires', top: 99 });
    expect(jsonNames(out)).toHaveLength(4);
  });

  it('caps identically in every format', () => {
    const options = { sort: 'fires', top: 2 } as const;

    expect(jsonNames(componentView(four(), 'skill', { ...options, format: 'json' }))).toHaveLength(
      2,
    );

    // csv: one header line plus the capped data rows.
    const csv = componentView(four(), 'skill', { ...options, format: 'csv' }).trim().split('\n');
    expect(csv).toHaveLength(3);

    // md: the capped names are present, the dropped ones are not.
    const md = componentView(four(), 'skill', { ...options, format: 'md' });
    expect(md).toContain('| a |');
    expect(md).toContain('| b |');
    expect(md).not.toContain('| c |');

    // terminal: same, on the rendered table.
    const terminal = componentView(four(), 'skill', { ...options, format: 'terminal' });
    expect(terminal).toContain('a');
    expect(terminal).not.toMatch(/^c\b/m);
  });

  it('applies to the report command too', () => {
    const out = report(four(), { format: 'json', sort: 'fires', top: 1 });
    expect(jsonNames(out)).toEqual(['a']);
  });
});
