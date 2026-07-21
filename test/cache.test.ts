/**
 * The parse cache: a second run over unchanged fixtures must produce an
 * identical report from cached entries, and a stale entry must be ignored.
 */
import { mkdtempSync, readdirSync, rmSync, utimesSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadReport } from '../src/load.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const previous = process.env['CLAUDE_CONFIG_DIR'];
let cacheTmp: string;

beforeEach(() => {
  cacheTmp = mkdtempSync(path.join(os.tmpdir(), 'skillscope-cache-'));
  process.env['SKILLSCOPE_CACHE_DIR'] = cacheTmp;
  process.env['CLAUDE_CONFIG_DIR'] = FIXTURES;
});

afterEach(() => {
  rmSync(cacheTmp, { recursive: true, force: true });
  delete process.env['SKILLSCOPE_CACHE_DIR'];
  if (previous === undefined) delete process.env['CLAUDE_CONFIG_DIR'];
  else process.env['CLAUDE_CONFIG_DIR'] = previous;
});

describe('parse cache', () => {
  it('produces the identical report on a warm run', async () => {
    const cold = await loadReport({ cache: true });
    expect(readdirSync(cacheTmp).length).toBeGreaterThan(0);

    const warm = await loadReport({ cache: true });
    expect(warm.sessions).toBe(cold.sessions);
    expect(warm.stats.lines).toBe(cold.stats.lines);
    expect(warm.stats.malformed).toBe(cold.stats.malformed);
    expect(warm.cost.totals.total).toBe(cold.cost.totals.total);
    expect(warm.used.map((u) => [u.name, u.fires])).toEqual(cold.used.map((u) => [u.name, u.fires]));
  });

  it('ignores an entry when the transcript mtime changes', async () => {
    const cold = await loadReport({ cache: true });
    // Bump every fixture's mtime: every entry is now stale, forcing a reparse.
    const now = new Date();
    for (const dirent of readdirSync(path.join(FIXTURES, 'projects', 'demo-project'), {
      withFileTypes: true,
    })) {
      if (dirent.isFile()) {
        utimesSync(path.join(FIXTURES, 'projects', 'demo-project', dirent.name), now, now);
      }
    }
    const reparsed = await loadReport({ cache: true });
    expect(reparsed.cost.totals.total).toBe(cold.cost.totals.total);
  });

  it('stays off unless asked', async () => {
    await loadReport({});
    expect(readdirSync(cacheTmp)).toEqual([]);
  });
});
