/**
 * CLI behaviour, driven through `run()` with stdout captured.
 * `CLAUDE_CONFIG_DIR` points at the fixtures, so these tests never read the
 * developer's own history.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from '../src/cli.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const previous = process.env['CLAUDE_CONFIG_DIR'];

let out: string[];
let err: string[];
let cacheTmp: string;

beforeEach(() => {
  out = [];
  err = [];
  // Keep the parse cache out of the developer's real ~/.cache during tests.
  cacheTmp = mkdtempSync(path.join(os.tmpdir(), 'skillscope-cache-'));
  process.env['SKILLSCOPE_CACHE_DIR'] = cacheTmp;
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
  rmSync(cacheTmp, { recursive: true, force: true });
  delete process.env['SKILLSCOPE_CACHE_DIR'];
  if (previous === undefined) delete process.env['CLAUDE_CONFIG_DIR'];
  else process.env['CLAUDE_CONFIG_DIR'] = previous;
});

const stdout = (): string => out.join('');

describe('argument handling', () => {
  it('prints help and exits cleanly', async () => {
    expect(await run(['--help'])).toBe(0);
    expect(stdout()).toContain('skillscope [command] [options]');
  });

  it('rejects an unknown command without a stack trace', async () => {
    expect(await run(['wat'])).toBe(2);
    expect(err.join('')).toContain('Unknown command: wat');
  });

  it('rejects an unknown --sort', async () => {
    expect(await run(['skills', '--sort', 'sideways'])).toBe(2);
    expect(err.join('')).toContain('Unknown --sort: sideways');
  });

  it('accepts --sort name and --sort sessions', async () => {
    for (const key of ['name', 'sessions']) {
      out.length = 0;
      expect(await run(['skills', '--sort', key, '--json'])).toBe(0);
      expect(() => JSON.parse(stdout())).not.toThrow();
    }
  });
});

describe('report over the fixture history', () => {
  it('summarises what fired', async () => {
    expect(await run([])).toBe(0);
    expect(stdout()).toContain('SkillScope');
    expect(stdout()).toContain('Fired at least once');
    expect(stdout()).toContain('sessions / active day');
  });

  it('emits parseable json', async () => {
    expect(await run(['--json'])).toBe(0);
    const parsed = JSON.parse(stdout()) as {
      generatedBy: string;
      sessions: number;
      untracked: { name: string; kind: string }[];
      tokens: { measuredTotal: { total: number } };
    };

    expect(parsed.generatedBy).toBe('skillscope');
    expect(parsed.sessions).toBeGreaterThan(0);
    // The fixture tree contains one Agent call, and no agent is installed here.
    expect(parsed.untracked.some((c) => c.kind === 'agent' && c.name === 'Explore')).toBe(true);
    expect(parsed.tokens.measuredTotal.total).toBeGreaterThan(0);
  });

  it('emits markdown with --md', async () => {
    expect(await run(['--md'])).toBe(0);
    expect(stdout()).toContain('# SkillScope report');
  });

  it('filters by --since', async () => {
    await run(['--json']);
    const all = JSON.parse(stdout()) as { tokens: { measuredTotal: { total: number } } };

    out = [];
    await run(['--json', '--since', '2099-01-01']);
    const none = JSON.parse(stdout()) as { tokens: { measuredTotal: { total: number } } };

    expect(all.tokens.measuredTotal.total).toBeGreaterThan(0);
    expect(none.tokens.measuredTotal.total).toBe(0);
  });
});

describe('hooks command', () => {
  it('renders the hook component view', async () => {
    expect(await run(['hooks'])).toBe(0);
    expect(stdout()).toContain('Hooks');
  });

  it('emits parseable json and honours --dead', async () => {
    expect(await run(['hooks', '--json'])).toBe(0);
    expect(() => JSON.parse(stdout())).not.toThrow();

    out.length = 0;
    expect(await run(['hooks', '--dead'])).toBe(0);
    expect(stdout()).toContain('Hooks that have never fired');
  });
});

describe('--until', () => {
  it('bounds the window from above', async () => {
    await run(['--json']);
    const all = JSON.parse(stdout()) as { tokens: { measuredTotal: { total: number } } };

    out = [];
    await run(['--json', '--until', '1970-01-01']);
    const none = JSON.parse(stdout()) as { tokens: { measuredTotal: { total: number } } };

    expect(all.tokens.measuredTotal.total).toBeGreaterThan(0);
    expect(none.tokens.measuredTotal.total).toBe(0);
  });

  it('combines with --since to scope an arbitrary window', async () => {
    expect(await run(['--json', '--since', '1970-01-01', '--until', '2099-01-01'])).toBe(0);
    const windowed = JSON.parse(stdout()) as { tokens: { measuredTotal: { total: number } } };
    expect(windowed.tokens.measuredTotal.total).toBeGreaterThan(0);

    // An empty window (since == until) yields nothing, since --until is exclusive.
    out = [];
    await run(['--json', '--since', '2026-01-01', '--until', '2026-01-01']);
    const empty = JSON.parse(stdout()) as { tokens: { measuredTotal: { total: number } } };
    expect(empty.tokens.measuredTotal.total).toBe(0);
  });

  it('works on any command, not just wrapped', async () => {
    expect(await run(['skills', '--until', '2099-01-01', '--json'])).toBe(0);
    expect(() => JSON.parse(stdout())).not.toThrow();
  });

  it('rejects a malformed date on either bound', async () => {
    for (const flag of ['--since', '--until']) {
      err.length = 0;
      expect(await run([flag, 'last-tuesday'])).toBe(2);
      expect(err.join('')).toContain(`${flag} expects YYYY-MM-DD`);
    }
  });

  it('accepts a year or year-month prefix', async () => {
    for (const value of ['2026', '2026-07', '2026-07-21']) {
      out.length = 0;
      expect(await run(['--json', '--until', value])).toBe(0);
      expect(() => JSON.parse(stdout())).not.toThrow();
    }
  });
});

describe('no history to read', () => {
  it('explains instead of failing', async () => {
    process.env['CLAUDE_CONFIG_DIR'] = path.join(FIXTURES, 'nowhere');
    expect(await run([])).toBe(0);
    expect(stdout()).toContain('found no Claude Code history');
    expect(stdout()).toContain('CLAUDE_CONFIG_DIR');
  });
});
