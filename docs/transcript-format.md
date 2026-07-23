# Transcript format

Claude Code writes one JSONL file per session under
`~/.claude/projects/<project>/<session>.jsonl` (subagents get their own files
under `<session>/subagents/`). Each line is one entry with a `type` field.
`KNOWN_ENTRY_TYPES` in [`src/parser/schema.ts`](../src/parser/schema.ts) lists
every `type` skillscope recognizes; anything else becomes an `unknown` event and
is surfaced (one line) rather than silently dropped.

This page describes each entry type's rough shape and **whether skillscope reads
it**, so contributors don't have to re-probe their own transcripts. It documents
the *sanitized* structure only — the schema and the scrubbed fixtures, never raw
transcript prose. To generate a scrubbed sample from your own history, use
`node scripts/make-fixture.mjs` (it strips all prose — see
[CONTRIBUTING.md](../CONTRIBUTING.md)).

Transcripts are **not a contract**: every field is optional, and the schema is
derived from surveyed real sessions ("when real data contradicts the schema, the
real data wins"). Fields common to most entries are `type`, `uuid`, `sessionId`,
`timestamp`, `cwd`, `version`, and `gitBranch`.

## What skillscope reads

Only three entry types produce events (see
[`src/parser/adapters/v1.ts`](../src/parser/adapters/v1.ts)):

| `type` | Shape (relevant fields) | skillscope reads it for |
| --- | --- | --- |
| `assistant` | `message.usage` (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`), `message.model`, `message.content[]` blocks, and per-message `attributionSkill` / `attributionPlugin` | **Token usage** (a `usage` event per assistant message) and **tool calls**: a `Skill` tool block → a skill firing; an `Agent`/`Task` block → a subagent firing. |
| `user` | `message.content[]` (text markers + `tool_result` blocks) and `toolUseResult` (`agentId`, `resolvedModel`, `status`) | **Slash-command skill invocations** (a non-builtin command marker in user text) and the **subagent link** (`toolUseResult.agentId` ties an `Agent` call to the transcript that subagent writes). |
| `system` | `subtype`, and for `stop_hook_summary`: `hookCount`, `hookInfos[]` (`command`, `durationMs`) | **Hook executions** — one `hook` event per `hookInfos` entry, but only when `subtype === "stop_hook_summary"`. Other system subtypes are ignored. |

## Recognized but not (yet) read

These are listed in `KNOWN_ENTRY_TYPES` so they don't trip the `unknown`-event
path, but the adapter's `switch` falls through to `default` and derives no event
from them. They're pass-through today — a natural starting point if skillscope
grows to use them.

| `type` | What it is |
| --- | --- |
| `attachment` | A file/image attached to a turn. |
| `queue-operation` | A queued-prompt operation (enqueue/dequeue of user input). |
| `last-prompt` | A marker recording the most recent prompt. |
| `custom-title` | A user-set session title. |
| `ai-title` | A model-generated session title. |
| `mode` | A mode marker for the session. |
| `file-history-snapshot` | A snapshot of file state for the edit-history feature. |
| `file-history-delta` | An incremental change on top of a snapshot. |
| `permission-mode` | The active permission mode (e.g. plan / accept-edits). |
| `pr-link` | A pull-request link associated with the session. |
| `agent-name` | A subagent's name marker. |
| `summary` | A session summary entry. |

If you add support for one of these, update `KNOWN_ENTRY_TYPES` only if a new
`type` appears, add a branch in `v1.ts`, and refresh this table.
