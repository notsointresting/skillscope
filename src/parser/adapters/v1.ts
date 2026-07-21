/**
 * Adapter for Claude Code transcript format v1 (versions 2.1.x).
 *
 * A new transcript format = a new file next to this one + a branch in
 * `pickAdapter()`. That is the community extension point; nothing else moves.
 */
import type { RawContentBlock, RawEntry, SessionEvent } from '../schema.js';

export interface EntryContext {
  /** Fallback project label when an entry carries no `cwd` (e.g. the project dir name). */
  fallbackProject: string;
  /** Fallback session id when an entry carries no `sessionId` (e.g. the file name). */
  fallbackSessionId: string;
  /** Set when parsing a subagent transcript; entries there carry no `sessionId`/`cwd`. */
  agentId?: string;
}

const COMMAND_NAME_RE = /<command-name>\s*\/?([^<\s]+)\s*<\/command-name>/;

/** Slash commands that are Claude Code builtins, not skills. */
const BUILTIN_COMMANDS = new Set([
  'model',
  'login',
  'logout',
  'clear',
  'compact',
  'config',
  'help',
  'cost',
  'doctor',
  'init',
  'review',
  'resume',
  'status',
  'exit',
  'quit',
  'vim',
  'memory',
  'permissions',
  'hooks',
  'agents',
  'mcp',
  'terminal-setup',
  'upgrade',
  'release-notes',
  'bug',
  'pr-comments',
  'add-dir',
  'export',
  'fast',
]);

function splitPluginName(name: string): { name: string; plugin?: string } {
  const i = name.indexOf(':');
  return i === -1 ? { name } : { plugin: name.slice(0, i), name };
}

type EventBaseFields = {
  sessionId: string;
  project: string;
  timestamp: string;
  version?: string;
  agentId?: string;
};

export function mapEntry(entry: RawEntry, ctx: EntryContext): SessionEvent[] {
  const base: EventBaseFields = {
    sessionId: entry.sessionId ?? ctx.fallbackSessionId,
    project: entry.cwd ?? ctx.fallbackProject,
    timestamp: entry.timestamp ?? '',
    ...(entry.version === undefined ? {} : { version: entry.version }),
    ...(entry.agentId ?? ctx.agentId ? { agentId: entry.agentId ?? ctx.agentId } : {}),
  };
  const out: SessionEvent[] = [];

  switch (entry.type) {
    case 'assistant': {
      const usage = entry.message?.usage;
      if (usage) {
        out.push({
          kind: 'usage',
          ...base,
          ...(entry.message?.model === undefined ? {} : { model: entry.message.model }),
          input: usage.input_tokens ?? 0,
          output: usage.output_tokens ?? 0,
          cacheCreate: usage.cache_creation_input_tokens ?? 0,
          cacheRead: usage.cache_read_input_tokens ?? 0,
          ...(entry.attributionSkill === undefined
            ? {}
            : { attributionSkill: entry.attributionSkill }),
          ...(entry.attributionPlugin === undefined
            ? {}
            : { attributionPlugin: entry.attributionPlugin }),
        });
      }
      for (const block of blocks(entry)) {
        if (block.type !== 'tool_use' || !block.name) continue;
        out.push(...mapToolUse(block, base));
      }
      break;
    }

    case 'user': {
      // The result of an `Agent` call names the transcript that subagent writes to.
      const linkedAgentId = entry.toolUseResult?.agentId;
      if (linkedAgentId) {
        for (const block of blocks(entry)) {
          if (block.type !== 'tool_result' || !block.tool_use_id) continue;
          out.push({
            kind: 'subagent-link',
            ...base,
            toolUseId: block.tool_use_id,
            linkedAgentId,
            ...(entry.toolUseResult?.resolvedModel === undefined
              ? {}
              : { model: entry.toolUseResult.resolvedModel }),
          });
        }
      }

      // Slash-command invocations arrive as markers inside user content.
      for (const text of userTexts(entry)) {
        const m = COMMAND_NAME_RE.exec(text);
        const raw = m?.[1];
        if (!raw || BUILTIN_COMMANDS.has(raw)) continue;
        out.push({ kind: 'skill', ...base, ...splitPluginName(raw), via: 'command-name' });
      }
      break;
    }

    case 'system': {
      if (entry.subtype === 'stop_hook_summary' && Array.isArray(entry.hookInfos)) {
        for (const hook of entry.hookInfos) {
          if (!hook?.command) continue;
          out.push({
            kind: 'hook',
            ...base,
            command: hook.command,
            ...(hook.durationMs === undefined ? {} : { durationMs: hook.durationMs }),
          });
        }
      }
      break;
    }

    default:
      break;
  }

  return out;
}

function mapToolUse(block: RawContentBlock, base: EventBaseFields): SessionEvent[] {
  const name = block.name;
  if (!name) return [];

  if (name === 'Skill') {
    const skill = block.input?.['skill'];
    if (typeof skill === 'string' && skill) {
      return [{ kind: 'skill', ...base, ...splitPluginName(skill), via: 'skill-tool' }];
    }
    return [];
  }

  // `Task` was the pre-2.1 name for the subagent tool; both map to one event.
  if (name === 'Agent' || name === 'Task') {
    const type = block.input?.['subagent_type'];
    const description = block.input?.['description'];
    return [
      {
        kind: 'subagent',
        ...base,
        name: typeof type === 'string' && type ? type : 'general-purpose',
        ...(typeof description === 'string' ? { description } : {}),
        ...(block.id ? { toolUseId: block.id } : {}),
      },
    ];
  }

  const mcp = /^mcp__(.+?)__(.+)$/.exec(name);
  return [
    {
      kind: 'tool',
      ...base,
      name,
      ...(mcp ? { mcpServer: mcp[1] as string, mcpTool: mcp[2] as string } : {}),
    },
  ];
}

function blocks(entry: RawEntry): RawContentBlock[] {
  const content = entry.message?.content;
  return Array.isArray(content) ? content : [];
}

function userTexts(entry: RawEntry): string[] {
  const content = entry.message?.content;
  if (typeof content === 'string') return [content];
  if (!Array.isArray(content)) return [];
  const texts: string[] = [];
  for (const b of content) if (typeof b.text === 'string') texts.push(b.text);
  return texts;
}
