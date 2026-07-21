/**
 * Stream one session transcript into normalized events.
 *
 * Transcripts reach 60 MB+, so lines are read one at a time and never buffered
 * whole. Nothing here writes: SkillScope is read-only over `~/.claude`.
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

import { mapEntry, type EntryContext } from './adapters/v1.js';
import { KNOWN_ENTRY_TYPES, type ParseStats, type RawEntry, type SessionEvent } from './schema.js';

const KNOWN = new Set<string>(KNOWN_ENTRY_TYPES);

/** Only one format so far (2.1.x). New format → new adapter file, new branch here. */
function pickAdapter(_version: string | undefined): typeof mapEntry {
  return mapEntry;
}

export interface ParseOptions {
  stats?: ParseStats;
  /** Called at most once per unrecognized entry type, per file. */
  onUnknownType?: (entryType: string) => void;
}

/** A transcript on disk, plus the identity its own entries may not carry. */
export interface TranscriptFile {
  path: string;
  /** `~/.claude/projects/<projectDir>` — the encoded project path. */
  projectDir: string;
  /** Owning session. For a subagent transcript this is the *parent* session. */
  sessionId: string;
  /** Set for `<session>/subagents/agent-<id>.jsonl`. */
  agentId?: string;
}

export async function* parseTranscript(
  file: string | TranscriptFile,
  options: ParseOptions = {},
): AsyncGenerator<SessionEvent> {
  const transcript = typeof file === 'string' ? describeTranscript(file) : file;
  const filePath = transcript.path;
  const stats = options.stats;
  const warned = new Set<string>();
  const ctx: EntryContext = {
    fallbackProject: transcript.projectDir,
    fallbackSessionId: transcript.sessionId,
    ...(transcript.agentId === undefined ? {} : { agentId: transcript.agentId }),
  };

  if (stats) stats.files++;

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      if (stats) stats.lines++;

      let entry: RawEntry;
      try {
        entry = JSON.parse(line) as RawEntry;
      } catch {
        // A truncated final line is normal for a session still being written.
        if (stats) stats.malformed++;
        continue;
      }

      const type = entry.type ?? '';
      if (!KNOWN.has(type)) {
        if (stats) stats.unknownTypes.set(type, (stats.unknownTypes.get(type) ?? 0) + 1);
        if (!warned.has(type)) {
          warned.add(type);
          options.onUnknownType?.(type);
        }
        yield {
          kind: 'unknown',
          sessionId: entry.sessionId ?? ctx.fallbackSessionId,
          project: entry.cwd ?? ctx.fallbackProject,
          timestamp: entry.timestamp ?? '',
          entryType: type,
        };
        continue;
      }

      yield* pickAdapter(entry.version)(entry, ctx);
    }
  } finally {
    rl.close();
  }
}

/**
 * Identify a transcript from its path. Two layouts exist:
 *   <root>/<projectDir>/<session>.jsonl
 *   <root>/<projectDir>/<session>/subagents/agent-<id>.jsonl
 */
export function describeTranscript(filePath: string): TranscriptFile {
  const name = path.basename(filePath, '.jsonl');
  const parent = path.dirname(filePath);

  if (path.basename(parent) === 'subagents') {
    const sessionDir = path.dirname(parent);
    return {
      path: filePath,
      projectDir: path.basename(path.dirname(sessionDir)),
      sessionId: path.basename(sessionDir),
      agentId: name.startsWith('agent-') ? name.slice('agent-'.length) : name,
    };
  }

  return { path: filePath, projectDir: path.basename(parent), sessionId: name };
}

/**
 * Every transcript under a projects root, main sessions and subagent sidechains alike.
 * Subagents account for a third of the files here and all of their own tokens, so
 * skipping them would under-report every subagent in the report.
 */
export function findTranscripts(projectsRoot: string): TranscriptFile[] {
  const found: TranscriptFile[] = [];

  const walk = (dir: string, depth: number): void => {
    if (depth > 3) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (entry.name.endsWith('.jsonl')) found.push(describeTranscript(full));
    }
  };

  walk(projectsRoot, 0);
  return found;
}
