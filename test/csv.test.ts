import { describe, expect, it } from 'vitest';

import type { ComponentUsage } from '../src/analyze/attribute.js';
import { renderCsv } from '../src/render/csv.js';

function parseCsvRow(row: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < row.length; i++) {
    const char = row[i]!;
    if (char === '"' && quoted && row[i + 1] === '"') cell += row[++i]!;
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) {
      cells.push(cell);
      cell = '';
    }
    else cell += char;
  }
  cells.push(cell);
  return cells;
}

describe('renderCsv', () => {
  it('round-trips a component name containing a comma and quote', () => {
    const usage: ComponentUsage = {
      kind: 'skill',
      name: 'review, then "ship"',
      fires: 3,
      sessions: 2,
      projects: 1,
      firstFired: '2026-07-01T10:00:00.000Z',
      lastFired: '2026-07-02T11:00:00.000Z',
      tokens: { input: 10, output: 20, cacheRead: 30, cacheCreate: 40, total: 100 },
      overheadTokens: 0,
    };
    const csv = renderCsv({ used: [usage], untracked: [] });

    expect(parseCsvRow(csv.split('\n')[1]!)).toEqual([
      'skill',
      usage.name,
      '3',
      '2',
      '100',
      usage.firstFired,
      usage.lastFired,
    ]);
  });
});
