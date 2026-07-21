/**
 * Transcript schema, derived from real `~/.claude/projects/<project>/<session>.jsonl`
 * files written by Claude Code 2.1.201 – 2.1.215 (surveyed 2026-07-21, 275 sessions).
 *
 * Rule: when real data contradicts this file, the real data wins — update here first.
 */

/** Entry `type` values actually observed. Anything else becomes an `unknown` event. */
export const KNOWN_ENTRY_TYPES = [
  'user',
  'assistant',
  'system',
  'attachment',
  'queue-operation',
  'last-prompt',
  'custom-title',
  'ai-title',
  'mode',
  'file-history-snapshot',
  'file-history-delta',
  'permission-mode',
  'pr-link',
  'agent-name',
  'summary',
] as const;

export type EntryType = (typeof KNOWN_ENTRY_TYPES)[number];

/** Raw usage block on `assistant.message.usage`. */
export interface RawUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  service_tier?: string;
}

export interface RawContentBlock {
  type?: string;
  /** tool_use */
  name?: string;
  id?: string;
  input?: Record<string, unknown>;
  caller?: { type?: string };
  /** text / thinking */
  text?: string;
  /** tool_result */
  tool_use_id?: string;
  is_error?: boolean;
}

export interface RawMessage {
  role?: string;
  model?: string;
  content?: string | RawContentBlock[];
  usage?: RawUsage;
}

/** One parsed line of a transcript. Every field is optional: transcripts are not a contract. */
export interface RawEntry {
  type?: string;
  subtype?: string;
  uuid?: string;
  sessionId?: string;
  timestamp?: string;
  cwd?: string;
  version?: string;
  gitBranch?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  /** Present in subagent transcripts (`<session>/subagents/agent-<id>.jsonl`). */
  agentId?: string;
  message?: RawMessage;
  /** Per-message skill attribution, present on assistant entries produced while a skill was active. */
  attributionSkill?: string;
  attributionPlugin?: string;
  /** system/stop_hook_summary */
  hookCount?: number;
  hookInfos?: { command?: string; durationMs?: number }[];
  /**
   * Result metadata attached to the user entry that carries a `tool_result`.
   * For subagent launches it names the transcript the subagent will write to.
   */
  toolUseResult?: {
    agentId?: string;
    resolvedModel?: string;
    status?: string;
  };
  content?: unknown;
}

// ---------------------------------------------------------------------------
// Normalized events
// ---------------------------------------------------------------------------

export interface EventBase {
  sessionId: string;
  /** Absolute project path (`cwd`) when the transcript records one, else the project dir name. */
  project: string;
  timestamp: string;
  /** Claude Code version that wrote the entry, when recorded. */
  version?: string;
  /**
   * Set when the event comes from a subagent transcript. Subagents keep their own
   * files under `<session>/subagents/`, and their tokens belong to the subagent,
   * not to the main thread.
   */
  agentId?: string;
}

/**
 * A skill actually starting. Only explicit invocations count:
 * the `Skill` tool, or a `/slash-command` marker in user content.
 * `attributionSkill` is NOT a fire — it marks turns produced *under* a skill,
 * and is carried on `usage` events instead so cost can be attributed without
 * inflating fire counts.
 */
export interface SkillInvocation extends EventBase {
  kind: 'skill';
  name: string;
  plugin?: string;
  via: 'skill-tool' | 'command-name';
}

export interface SubagentInvocation extends EventBase {
  kind: 'subagent';
  /** `input.subagent_type`; the Agent tool defaults to general-purpose when omitted. */
  name: string;
  description?: string;
  /** id of the `Agent` tool_use, joined to a `subagent-link` to find its transcript. */
  toolUseId?: string;
}

/**
 * Ties an `Agent` call in the parent session to the transcript the subagent wrote.
 * Without it, tokens spent inside `<session>/subagents/agent-<id>.jsonl` could only
 * be guessed at; with it they are attributed exactly.
 */
export interface SubagentLink extends EventBase {
  kind: 'subagent-link';
  toolUseId: string;
  linkedAgentId: string;
  model?: string;
}

export interface HookFire extends EventBase {
  kind: 'hook';
  command: string;
  durationMs?: number;
}

/** Any tool call. MCP tools additionally carry `mcpServer` / `mcpTool`. */
export interface ToolCall extends EventBase {
  kind: 'tool';
  name: string;
  mcpServer?: string;
  mcpTool?: string;
}

export interface TokenUsage extends EventBase {
  kind: 'usage';
  model?: string;
  input: number;
  output: number;
  cacheCreate: number;
  cacheRead: number;
  /** Skill active when these tokens were spent, if Claude Code recorded one. */
  attributionSkill?: string;
  attributionPlugin?: string;
}

export interface UnknownEvent extends EventBase {
  kind: 'unknown';
  entryType: string;
}

export type SessionEvent =
  | SkillInvocation
  | SubagentInvocation
  | SubagentLink
  | HookFire
  | ToolCall
  | TokenUsage
  | UnknownEvent;

export interface ParseStats {
  files: number;
  lines: number;
  /** Lines that were not valid JSON. Counted, never fatal. */
  malformed: number;
  /** entry `type` → count, for types this build does not model yet. */
  unknownTypes: Map<string, number>;
}

export function emptyStats(): ParseStats {
  return { files: 0, lines: 0, malformed: 0, unknownTypes: new Map() };
}
