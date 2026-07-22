import { describe, expect, it } from 'vitest';

import type { ComponentUsage } from '../src/analyze/attribute.js';
import { componentView, type Sort } from '../src/commands.js';
import type { Report } from '../src/load.js';

function usage(name: string, sessions: number): ComponentUsage {
  return {
    kind: 'skill',
    name,
    fires: sessions,
    sessions,
    projects: 1,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0, total: 0 },
    overheadTokens: 0,
  };
}

// A minimal Report carrying just the rows the JSON view sorts and serialises.
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

function names(report: Report, sort: Sort): string[] {
  const json = componentView(report, 'skill', { format: 'json', sort });
  return (JSON.parse(json) as { used: { name: string }[] }).used.map((r) => r.name);
}

describe('--sort name', () => {
  it('orders rows alphabetically by name', () => {
    const report = reportWith([usage('gamma', 1), usage('alpha', 3), usage('beta', 2)]);
    expect(names(report, 'name')).toEqual(['alpha', 'beta', 'gamma']);
  });
});

describe('--sort sessions', () => {
  it('orders rows by sessions descending, name as tiebreaker', () => {
    const report = reportWith([
      usage('low', 1),
      usage('high', 5),
      usage('mid-b', 3),
      usage('mid-a', 3),
    ]);
    expect(names(report, 'sessions')).toEqual(['high', 'mid-a', 'mid-b', 'low']);
  });
});
