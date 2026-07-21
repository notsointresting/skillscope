/**
 * Build a sanitized test fixture from one real transcript.
 *
 *   node scripts/make-fixture.mjs <source.jsonl> <out.jsonl> [maxLines=250]
 *
 * Sanitizing is whitelist-based: every output entry is rebuilt from named fields,
 * so anything not explicitly listed here cannot leak. All prose — user text,
 * assistant text, thinking, tool inputs, tool results — becomes "[redacted]".
 * Structure, tool names, skill/subagent names, timestamps and token counts are
 * kept, because those are what the parser is a contract for.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const [src, out, maxLinesArg] = process.argv.slice(2);
if (!src || !out) {
  console.error('usage: make-fixture.mjs <source.jsonl> <out.jsonl> [maxLines]');
  process.exit(1);
}
const MAX_LINES = Number(maxLinesArg ?? 250);
const REDACTED = '[redacted]';
const HOME = os.homedir();
const USER = path.basename(HOME);

function scrub(text) {
  if (typeof text !== 'string') return REDACTED;
  return text
    .split(HOME)
    .join('/home/example')
    .split(HOME.replace(/\\/g, '\\\\'))
    .join('/home/example')
    .split(USER)
    .join('example');
}

const uuidMap = new Map();
/**
 * Ids are namespaced per output file. Without that, two fixtures made from two
 * different real sessions would both claim session `…0001`, and any test that
 * counts distinct sessions across fixtures would quietly be wrong.
 */
const namespace = (() => {
  let hash = 0;
  for (const char of path.basename(out)) hash = (hash * 31 + char.charCodeAt(0)) % 0x1000;
  return (0x8000 + hash).toString(16);
})();

function fakeUuid(real) {
  if (typeof real !== 'string') return undefined;
  if (!uuidMap.has(real)) {
    const n = uuidMap.size + 1;
    uuidMap.set(real, `00000000-0000-4000-${namespace}-${String(n).padStart(12, '0')}`);
  }
  return uuidMap.get(real);
}

const COMMAND_MARKER = /<command-name>[^<]*<\/command-name>/g;

/** Keep slash-command markers (the parser keys off them); drop everything else. */
function sanitizeText(text) {
  if (typeof text !== 'string') return REDACTED;
  const markers = text.match(COMMAND_MARKER);
  return markers ? markers.join('\n') : REDACTED;
}

function sanitizeBlock(block) {
  if (!block || typeof block !== 'object') return { type: 'text', text: REDACTED };
  switch (block.type) {
    case 'tool_use': {
      const input = {};
      if (typeof block.input?.skill === 'string') input.skill = block.input.skill;
      if (typeof block.input?.subagent_type === 'string') {
        input.subagent_type = block.input.subagent_type;
      }
      if (block.input && 'description' in block.input) input.description = REDACTED;
      return {
        type: 'tool_use',
        id: fakeUuid(block.id) ?? 'toolu_0000',
        name: block.name,
        input,
        ...(block.caller ? { caller: { type: block.caller.type } } : {}),
      };
    }
    case 'tool_result':
      return {
        type: 'tool_result',
        tool_use_id: fakeUuid(block.tool_use_id) ?? 'toolu_0000',
        is_error: Boolean(block.is_error),
        content: REDACTED,
      };
    case 'thinking':
      return { type: 'thinking', thinking: REDACTED, signature: '' };
    default:
      return { type: block.type ?? 'text', text: sanitizeText(block.text) };
  }
}

function sanitizeContent(content) {
  if (typeof content === 'string') return sanitizeText(content);
  if (Array.isArray(content)) return content.map(sanitizeBlock);
  return REDACTED;
}

function sanitizeEntry(e) {
  const common = {
    type: e.type,
    ...(e.uuid ? { uuid: fakeUuid(e.uuid) } : {}),
    ...(e.parentUuid ? { parentUuid: fakeUuid(e.parentUuid) } : {}),
    ...(e.sessionId ? { sessionId: fakeUuid(e.sessionId) } : {}),
    ...(e.timestamp ? { timestamp: e.timestamp } : {}),
    ...(e.cwd ? { cwd: '/home/example/project-a' } : {}),
    ...(e.version ? { version: e.version } : {}),
    ...(e.gitBranch ? { gitBranch: 'main' } : {}),
    ...(e.isSidechain === undefined ? {} : { isSidechain: e.isSidechain }),
    ...(e.isMeta === undefined ? {} : { isMeta: e.isMeta }),
    ...(e.agentId ? { agentId: e.agentId } : {}),
  };

  if (e.type === 'assistant' || e.type === 'user') {
    // Only the three fields that link a subagent launch to its transcript;
    // toolUseResult also carries the prompt and an absolute output path.
    const link = e.toolUseResult?.agentId
      ? {
          toolUseResult: {
            agentId: e.toolUseResult.agentId,
            ...(e.toolUseResult.resolvedModel
              ? { resolvedModel: e.toolUseResult.resolvedModel }
              : {}),
            ...(e.toolUseResult.status ? { status: e.toolUseResult.status } : {}),
          },
        }
      : {};
    return {
      ...common,
      ...link,
      ...(e.attributionSkill ? { attributionSkill: e.attributionSkill } : {}),
      ...(e.attributionPlugin ? { attributionPlugin: e.attributionPlugin } : {}),
      message: {
        ...(e.message?.role ? { role: e.message.role } : {}),
        ...(e.message?.model ? { model: e.message.model } : {}),
        content: sanitizeContent(e.message?.content),
        ...(e.message?.usage ? { usage: e.message.usage } : {}),
      },
    };
  }

  if (e.type === 'system') {
    return {
      ...common,
      ...(e.subtype ? { subtype: e.subtype } : {}),
      ...(e.level ? { level: e.level } : {}),
      ...(e.hookCount === undefined ? {} : { hookCount: e.hookCount }),
      ...(Array.isArray(e.hookInfos)
        ? {
            hookInfos: e.hookInfos.map((h) => ({
              command: scrub(h?.command).slice(0, 120),
              ...(h?.durationMs === undefined ? {} : { durationMs: h.durationMs }),
            })),
          }
        : {}),
      ...(typeof e.content === 'string' ? { content: sanitizeText(e.content) } : {}),
    };
  }

  return common;
}

/** Lines that exercise the parser, so a small fixture still covers the interesting paths. */
function interest(e) {
  if (e.type === 'system' && e.subtype === 'stop_hook_summary') return 3;
  if (e.toolUseResult?.agentId) return 3;
  if (e.attributionSkill) return 3;
  const c = e.message?.content;
  if (Array.isArray(c) && c.some((b) => b?.type === 'tool_use')) return 3;
  if (typeof c === 'string' && c.includes('<command-name>')) return 3;
  if (e.type === 'assistant' && e.message?.usage) return 2;
  return 1;
}

const kept = [];
const rl = readline.createInterface({
  input: fs.createReadStream(src, { encoding: 'utf8' }),
  crlfDelay: Infinity,
});
let index = 0;
for await (const line of rl) {
  if (!line.trim()) continue;
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    continue;
  }
  kept.push({ index: index++, score: interest(entry), entry });
}

kept.sort((a, b) => b.score - a.score || a.index - b.index);
const chosen = kept.slice(0, MAX_LINES).sort((a, b) => a.index - b.index);

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, chosen.map((k) => JSON.stringify(sanitizeEntry(k.entry))).join('\n') + '\n');
console.log(`${out}: ${chosen.length} lines from ${kept.length}`);
