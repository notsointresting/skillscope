/**
 * Per-transcript parse cache. A transcript that has not changed (same mtime and
 * size) parses to the same events, so the second run reads JSON instead.
 *
 * Every operation here is best-effort: a missing, corrupt or unwritable cache
 * must never break a report. Failure means "parse it again", nothing more.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { SessionEvent } from './parser/schema.js';

/** Bump when SessionEvent or the parser changes shape; stale entries just miss. */
const CACHE_VERSION = 1;

export interface CacheEntry {
  v: number;
  mtimeMs: number;
  size: number;
  events: SessionEvent[];
  lines: number;
  malformed: number;
  unknown: Record<string, number>;
}

export function cacheDir(): string {
  return process.env['SKILLSCOPE_CACHE_DIR'] ?? path.join(os.homedir(), '.cache', 'skillscope');
}

function entryPath(transcriptPath: string): string {
  const hash = createHash('sha1').update(transcriptPath).digest('hex');
  return path.join(cacheDir(), `${hash}.json`);
}

export function readCache(transcriptPath: string, stat: fs.Stats): CacheEntry | undefined {
  try {
    const raw = fs.readFileSync(entryPath(transcriptPath), 'utf8');
    const entry = JSON.parse(raw) as CacheEntry;
    if (entry.v !== CACHE_VERSION || entry.mtimeMs !== stat.mtimeMs || entry.size !== stat.size) {
      return undefined;
    }
    return entry;
  } catch {
    return undefined;
  }
}

export function writeCache(transcriptPath: string, entry: CacheEntry): void {
  try {
    fs.mkdirSync(cacheDir(), { recursive: true });
    fs.writeFileSync(entryPath(transcriptPath), JSON.stringify(entry));
  } catch {
    // Read-only disk, quota, whatever — the report is already correct without it.
  }
}

export function makeEntry(
  stat: fs.Stats,
  events: SessionEvent[],
  lines: number,
  malformed: number,
  unknown: Record<string, number>,
): CacheEntry {
  return { v: CACHE_VERSION, mtimeMs: stat.mtimeMs, size: stat.size, events, lines, malformed, unknown };
}
