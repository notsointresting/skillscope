/**
 * One pass over the local install: find it, parse it, join it.
 * Every command needs exactly this, so it lives in one place.
 */
import fs from 'node:fs';

import { attribute, type Attribution } from './analyze/attribute.js';
import { makeEntry, readCache, writeCache } from './cache.js';
import { findClaudeDirs, type ClaudeDirs } from './discovery/claude-dirs.js';
import { findInstalled } from './discovery/installed.js';
import { emptyStats, type ParseStats, type SessionEvent } from './parser/schema.js';
import { findTranscripts, parseTranscript } from './parser/transcript.js';

export interface LoadOptions {
  /** Overrides `os.homedir()`; the CLI never needs it, tests always do. */
  home?: string;
  /** ISO date (`YYYY-MM-DD`) — ignore events before it. */
  since?: string;
  /** ISO date prefix — ignore events on/after it (exclusive). Pairs with `since` for a month. */
  until?: string;
  /** Only sessions whose project path contains this string. */
  project?: string;
  /** Reuse parsed events for unchanged transcripts (mtime+size keyed). Off by default. */
  cache?: boolean;
}

export interface Report extends Attribution {
  dirs: ClaudeDirs;
  stats: ParseStats;
  /** Entry types this build does not model yet, worth one line of output. */
  unknownTypes: string[];
}

export async function loadReport(options: LoadOptions = {}): Promise<Report> {
  const dirs = findClaudeDirs(options.home);
  const stats = emptyStats();
  const events: SessionEvent[] = [];

  for (const file of findTranscripts(dirs.projects)) {
    // The cache holds unfiltered events per file; since/project filters apply after.
    const stat = options.cache ? statSafe(file.path) : undefined;
    const cached = stat ? readCache(file.path, stat) : undefined;
    let fileEvents: SessionEvent[];

    if (cached) {
      stats.files++;
      stats.lines += cached.lines;
      stats.malformed += cached.malformed;
      for (const [type, count] of Object.entries(cached.unknown)) {
        stats.unknownTypes.set(type, (stats.unknownTypes.get(type) ?? 0) + count);
      }
      fileEvents = cached.events;
    } else {
      const fileStats = emptyStats();
      fileEvents = [];
      for await (const event of parseTranscript(file, { stats: fileStats })) {
        fileEvents.push(event);
      }
      stats.files += fileStats.files;
      stats.lines += fileStats.lines;
      stats.malformed += fileStats.malformed;
      for (const [type, count] of fileStats.unknownTypes) {
        stats.unknownTypes.set(type, (stats.unknownTypes.get(type) ?? 0) + count);
      }
      if (stat) {
        writeCache(
          file.path,
          makeEntry(
            stat,
            fileEvents,
            fileStats.lines,
            fileStats.malformed,
            Object.fromEntries(fileStats.unknownTypes),
          ),
        );
      }
    }

    for (const event of fileEvents) {
      if (options.since && event.timestamp && event.timestamp < options.since) continue;
      if (options.until && event.timestamp && event.timestamp >= options.until) continue;
      if (options.project && !matchesProject(event.project, options.project)) continue;
      events.push(event);
    }
  }

  const installed = findInstalled(dirs, projectPathsOf(events));

  return {
    ...attribute(events, installed),
    dirs,
    stats,
    unknownTypes: [...stats.unknownTypes.keys()],
  };
}

function statSafe(file: string): fs.Stats | undefined {
  try {
    return fs.statSync(file);
  } catch {
    return undefined;
  }
}

/** Project paths are compared case-insensitively: Windows records both casings. */
function matchesProject(project: string, needle: string): boolean {
  return project.toLowerCase().includes(needle.toLowerCase());
}

/** Projects that actually appear in the history, so per-project components get found. */
function projectPathsOf(events: SessionEvent[]): string[] {
  const paths = new Set<string>();
  for (const event of events) {
    // The encoded directory name is not a real path; only absolute `cwd` values are.
    if (event.project && /[/\\]/.test(event.project)) paths.add(event.project);
  }
  return [...paths];
}
