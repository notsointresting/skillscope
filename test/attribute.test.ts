/**
 * Attribution gate: every number here was computed independently from the fixtures
 * (a separate hand-written summer that does not use the parser) before being
 * asserted, per the plan's "hand-checked against manual counts".
 *
 *   session-skills.jsonl   superpowers:executing-plans = 873,964 tokens / 138 messages
 *                          refero-design               = 119,610 tokens /   9 messages
 *   subagent transcript    146,432 tokens / 41 usage entries, agent a8d371e944693e996
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { attribute } from '../src/analyze/attribute.js';
import { attributeCost, costKey } from '../src/analyze/cost.js';
import type { InstalledComponent } from '../src/discovery/installed.js';
import type { SessionEvent } from '../src/parser/schema.js';
import { findTranscripts, parseTranscript } from '../src/parser/transcript.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

async function eventsOf(...names: string[]): Promise<SessionEvent[]> {
  const events: SessionEvent[] = [];
  for (const name of names) {
    for await (const event of parseTranscript(path.join(FIXTURES, name))) events.push(event);
  }
  return events;
}

async function eventsOfProjectTree(): Promise<SessionEvent[]> {
  const events: SessionEvent[] = [];
  for (const file of findTranscripts(path.join(FIXTURES, 'projects'))) {
    for await (const event of parseTranscript(file)) events.push(event);
  }
  return events;
}

const skill = (name: string): InstalledComponent => ({
  kind: 'skill',
  name,
  source: 'plugin',
  path: path.join(FIXTURES, 'nonexistent', 'SKILL.md'),
});

const agent = (name: string): InstalledComponent => ({
  kind: 'agent',
  name,
  source: 'user',
  path: path.join(FIXTURES, 'nonexistent.md'),
});

describe('joining installed components against transcripts', () => {
  it('counts fires per skill, from both the Skill tool and slash commands', async () => {
    const events = await eventsOf('session-skills.jsonl');
    const result = attribute(events, [
      skill('superpowers:executing-plans'),
      skill('caveman:caveman'),
      skill('never-used'),
    ]);

    expect(result.used.find((u) => u.name === 'superpowers:executing-plans')?.fires).toBe(1);
    expect(result.used.find((u) => u.name === 'caveman:caveman')?.fires).toBe(1);
  });

  it('lists installed components that never fired as dead weight', async () => {
    const events = await eventsOf('session-skills.jsonl');
    const result = attribute(events, [skill('superpowers:executing-plans'), skill('never-used')]);

    expect(result.dead.map((d) => d.name)).toEqual(['never-used']);
  });

  it('reports components that fired but are not installed without calling them dead', async () => {
    const events = await eventsOf('session-skills.jsonl');
    const result = attribute(events, [skill('superpowers:executing-plans')]);

    expect(result.untracked.map((u) => u.name)).toContain('refero-design');
    expect(result.dead).toEqual([]);
  });

  it('tracks first and last use, sessions and projects', async () => {
    const events = await eventsOf('session-skills.jsonl', 'session-agents.jsonl');
    const result = attribute(events, [skill('caveman:caveman')]);

    const caveman = result.used.find((u) => u.name === 'caveman:caveman');
    expect(caveman?.fires).toBe(2); // once per fixture
    expect(caveman?.sessions).toBe(2); // two different sessions
    expect(caveman?.projects).toBe(1); // both sanitized to the same project path
    expect(caveman?.firstFired).toBeDefined();
    expect(caveman?.lastFired).toBeDefined();
    expect(caveman!.firstFired! <= caveman!.lastFired!).toBe(true);
  });

  it('counts subagent invocations and hook fires (45 and 286)', async () => {
    const events = await eventsOf('session-agents.jsonl');
    const result = attribute(events, []);

    const subagentFires = result.untracked
      .filter((u) => u.kind === 'agent')
      .reduce((sum, u) => sum + u.fires, 0);
    const hookFires = result.untracked
      .filter((u) => u.kind === 'hook')
      .reduce((sum, u) => sum + u.fires, 0);

    expect(subagentFires).toBe(45);
    expect(hookFires).toBe(286);
  });
});

describe('cost attribution', () => {
  it('sums measured tokens per skill (executing-plans = 873,964)', async () => {
    const cost = attributeCost(await eventsOf('session-skills.jsonl'));

    expect(cost.direct.get(costKey('skill', 'superpowers:executing-plans'))?.total).toBe(873_964);
    expect(cost.direct.get(costKey('skill', 'refero-design'))?.total).toBe(119_610);
  });

  it('leaves unattributed turns unattributed rather than spreading them around', async () => {
    const cost = attributeCost(await eventsOf('session-thinking.jsonl'));

    expect(cost.direct.size).toBe(0);
    expect(cost.unattributed.total).toBe(cost.totals.total);
    expect(cost.totals.total).toBeGreaterThan(0);
  });

  it('charges a subagent transcript to the Agent call that launched it (146,432)', async () => {
    const cost = attributeCost(await eventsOfProjectTree());

    expect(cost.direct.get(costKey('agent', 'Explore'))?.total).toBe(146_432);
    expect(cost.unlinkedSubagent.total).toBe(0);
  });

  it('keeps subagent tokens separate when the launch cannot be linked', async () => {
    // The subagent transcript on its own: no Agent call, so nothing to charge it to.
    const sub = findTranscripts(path.join(FIXTURES, 'projects')).find((f) => f.agentId);
    expect(sub).toBeDefined();
    const events: SessionEvent[] = [];
    for await (const event of parseTranscript(sub!)) events.push(event);

    const cost = attributeCost(events);
    expect(cost.unlinkedSubagent.total).toBe(146_432);
    expect(cost.direct.size).toBe(0);
  });

  it('rolls measured tokens into the joined report', async () => {
    const result = attribute(await eventsOfProjectTree(), [agent('Explore')]);

    expect(result.used.find((u) => u.name === 'Explore')?.tokens.total).toBe(146_432);
  });
});
