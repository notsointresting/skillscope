/**
 * `wrapped --open` launches the platform default app on the written SVG, and a
 * launch failure never crashes the command (the card is already on disk).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spawn = vi.fn();
vi.mock('node:child_process', () => ({ spawn }));

const { run } = await import('../src/cli.js');

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const OPENERS: Record<string, string> = { win32: 'start', darwin: 'open' };
const expectedCommand = OPENERS[process.platform] ?? 'xdg-open';

describe('wrapped --open', () => {
  const previous = process.env['CLAUDE_CONFIG_DIR'];
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'skillscope-open-'));
    process.env['SKILLSCOPE_CACHE_DIR'] = path.join(tmp, 'cache');
    process.env['CLAUDE_CONFIG_DIR'] = FIXTURES;
    spawn.mockReset();
    spawn.mockReturnValue({ on: vi.fn(), unref: vi.fn() });
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env['SKILLSCOPE_CACHE_DIR'];
    rmSync(tmp, { recursive: true, force: true });
    if (previous === undefined) delete process.env['CLAUDE_CONFIG_DIR'];
    else process.env['CLAUDE_CONFIG_DIR'] = previous;
  });

  it('spawns the platform opener on the written file', async () => {
    const file = path.join(tmp, 'card.svg');
    expect(await run(['wrapped', '--open', '--out', file])).toBe(0);
    expect(spawn).toHaveBeenCalledTimes(1);
    const [command, args] = spawn.mock.calls[0]!;
    expect(command).toBe(expectedCommand);
    expect(args).toEqual([file]);
  });

  it('does not spawn without --open', async () => {
    const file = path.join(tmp, 'card2.svg');
    expect(await run(['wrapped', '--out', file])).toBe(0);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('stays soft when the launch throws', async () => {
    spawn.mockImplementation(() => {
      throw new Error('no launcher');
    });
    const file = path.join(tmp, 'card3.svg');
    expect(await run(['wrapped', '--open', '--out', file])).toBe(0);
  });
});
