/**
 * The fixtures are the parser's contract. Every expected number below was counted
 * independently (grep over the fixture) before the assertion was written, so a
 * parser regression cannot quietly redefine "correct".
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  describeTranscript,
  findTranscripts,
  parseTranscript,
  type ParseOptions,
} from '../src/parser/transcript.js';
import { emptyStats, type SessionEvent } from '../src/parser/schema.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (name: string) => path.join(FIXTURES, name);

async function collect(name: string, options: ParseOptions = {}): Promise<SessionEvent[]> {
  const events: SessionEvent[] = [];
  for await (const event of parseTranscript(fixture(name), options)) events.push(event);
  return events;
}

const byKind = (events: SessionEvent[], kind: SessionEvent['kind']) =>
  events.filter((e) => e.kind === kind);

describe('subagents and hooks (session-agents.jsonl)', () => {
  it('finds one subagent event per Agent tool_use (45)', async () => {
    const subagents = byKind(await collect('session-agents.jsonl'), 'subagent');
    expect(subagents).toHaveLength(45);
    expect(subagents.every((s) => s.kind === 'subagent' && s.name.length > 0)).toBe(true);
  });

  it('links Agent calls to the transcripts their subagents wrote (39)', async () => {
    const events = await collect('session-agents.jsonl');
    const links = byKind(events, 'subagent-link');
    expect(links).toHaveLength(39);

    // Every link points back at an Agent call in the same session.
    const toolUseIds = new Set(
      byKind(events, 'subagent').map((s) => (s.kind === 'subagent' ? s.toolUseId : undefined)),
    );
    for (const link of links) {
      if (link.kind !== 'subagent-link') continue;
      expect(toolUseIds.has(link.toolUseId)).toBe(true);
      expect(link.linkedAgentId).toBeTruthy();
    }
  });

  it('finds one hook event per hookInfos entry (286)', async () => {
    const hooks = byKind(await collect('session-agents.jsonl'), 'hook');
    expect(hooks).toHaveLength(286);
    expect(hooks.every((h) => h.kind === 'hook' && h.command.length > 0)).toBe(true);
  });
});

describe('skills (session-skills.jsonl)', () => {
  it('finds one skill event per Skill tool_use (4)', async () => {
    const skills = byKind(await collect('session-skills.jsonl'), 'skill');
    const viaTool = skills.filter((s) => s.kind === 'skill' && s.via === 'skill-tool');
    expect(viaTool).toHaveLength(4);
  });

  it('splits plugin-qualified skill names', async () => {
    const skills = byKind(await collect('session-skills.jsonl'), 'skill');
    const qualified = skills.find((s) => s.kind === 'skill' && s.name.includes(':'));
    expect(qualified).toBeDefined();
    if (qualified?.kind === 'skill') {
      expect(qualified.plugin).toBe(qualified.name.split(':')[0]);
    }
  });

  it('carries per-message skill attribution on usage events (190)', async () => {
    const usage = byKind(await collect('session-skills.jsonl'), 'usage');
    const attributed = usage.filter((u) => u.kind === 'usage' && u.attributionSkill);
    expect(attributed).toHaveLength(190);
  });

  it('splits mcp__<server>__<tool> tool names (2)', async () => {
    const tools = byKind(await collect('session-skills.jsonl'), 'tool');
    const mcp = tools.filter((t) => t.kind === 'tool' && t.mcpServer);
    expect(mcp).toHaveLength(2);
    for (const call of mcp) {
      if (call.kind !== 'tool') continue;
      expect(call.name).toBe(`mcp__${call.mcpServer}__${call.mcpTool}`);
    }
  });
});

describe('slash-command invocations', () => {
  it('counts /command markers as skill fires but ignores builtins (13 of 14)', async () => {
    const files = ['session-agents.jsonl', 'session-skills.jsonl', 'session-commands.jsonl'];
    const skills: SessionEvent[] = [];
    for (const file of files) skills.push(...byKind(await collect(file), 'skill'));
    const viaCommand = skills.filter((s) => s.kind === 'skill' && s.via === 'command-name');
    // 2 + 4 + 8 markers across the three fixtures; the single /model is a builtin.
    expect(viaCommand).toHaveLength(13);
    expect(viaCommand.some((s) => s.kind === 'skill' && s.name === 'model')).toBe(false);
  });
});

describe('sessions without tools (session-thinking.jsonl)', () => {
  it('yields usage events only (80)', async () => {
    const events = await collect('session-thinking.jsonl');
    expect(byKind(events, 'usage')).toHaveLength(80);
    expect(byKind(events, 'tool')).toHaveLength(0);
    expect(byKind(events, 'skill')).toHaveLength(0);
    expect(byKind(events, 'subagent')).toHaveLength(0);
  });

  it('reports token counts', async () => {
    const usage = byKind(await collect('session-thinking.jsonl'), 'usage');
    const total = usage.reduce((sum, u) => sum + (u.kind === 'usage' ? u.output : 0), 0);
    expect(total).toBeGreaterThan(0);
  });
});

describe('discovery', () => {
  const root = path.join(FIXTURES, 'projects');

  it('finds main sessions and subagent sidechains', async () => {
    const found = findTranscripts(root);
    expect(found).toHaveLength(2);

    const main = found.find((f) => !f.agentId);
    expect(main?.sessionId).toBe('00000000-0000-4000-8000-0000000000aa');
    expect(main?.projectDir).toBe('demo-project');

    // A subagent transcript belongs to its parent session, under the same project.
    const sub = found.find((f) => f.agentId);
    expect(sub?.agentId).toBe('abc123');
    expect(sub?.sessionId).toBe('00000000-0000-4000-8000-0000000000aa');
    expect(sub?.projectDir).toBe('demo-project');
  });

  it('reads subagent identity out of the transcript path', () => {
    const described = describeTranscript(
      path.join(root, 'demo-project', 'sess-1', 'subagents', 'agent-xyz.jsonl'),
    );
    expect(described).toMatchObject({
      projectDir: 'demo-project',
      sessionId: 'sess-1',
      agentId: 'xyz',
    });
  });

  it('tags subagent events with the agent that spent them (41 usage events)', async () => {
    const sub = findTranscripts(root).find((f) => f.agentId);
    expect(sub).toBeDefined();
    const events: SessionEvent[] = [];
    for await (const event of parseTranscript(sub!)) events.push(event);

    const usage = byKind(events, 'usage');
    expect(usage).toHaveLength(41);
    expect(usage.every((u) => u.agentId === 'a8d371e944693e996')).toBe(true);
  });
});

describe('damaged transcripts', () => {
  it('survives malformed lines, unknown types and truncation', async () => {
    const stats = emptyStats();
    const warned: string[] = [];
    const events = await collect('corrupt.jsonl', {
      stats,
      onUnknownType: (t: string) => warned.push(t),
    });

    // Two unparsable lines: the garbage line and the truncated final line.
    expect(stats.malformed).toBe(2);
    // Unknown entry types are counted, surfaced once, and passed through.
    expect(warned).toEqual(['brand-new-entry-type-from-the-future']);
    expect(stats.unknownTypes.get('brand-new-entry-type-from-the-future')).toBe(2);
    expect(byKind(events, 'unknown')).toHaveLength(2);

    // Good lines around the damage are still parsed.
    expect(byKind(events, 'skill')).toHaveLength(2); // Skill tool + /demo:skill marker
    expect(byKind(events, 'hook')).toHaveLength(2);
    expect(byKind(events, 'usage')).toHaveLength(1);
  });

  it('reads project and session identity from the entries', async () => {
    const events = await collect('corrupt.jsonl');
    const first = events[0];
    expect(first?.project).toBe('/home/example/project-a');
    expect(first?.sessionId).toBe('00000000-0000-4000-8000-000000000001');
  });
});
