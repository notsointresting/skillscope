/**
 * Token attribution.
 *
 * Two numbers, kept apart because they are not equally trustworthy:
 *
 *   direct   — measured. Claude Code stamps assistant turns with `attributionSkill`,
 *              and subagents write their own transcripts, so those tokens are read,
 *              not inferred.
 *   overhead — estimated. Every installed skill and subagent puts its description in
 *              the system prompt of every session. There is no record of that in a
 *              transcript, so it is sized from the description text (chars / 4) and
 *              must always be labelled an estimate in output.
 */
import fs from 'node:fs';

import type { InstalledComponent } from '../discovery/installed.js';
import type { SessionEvent } from '../parser/schema.js';

export interface TokenTotals {
  input: number;
  output: number;
  cacheCreate: number;
  cacheRead: number;
  /** input + output + cache creation. Cache reads are tracked apart: they are near-free. */
  total: number;
}

export interface CostModel {
  /** `${kind}:${name}` → measured tokens. */
  direct: Map<string, TokenTotals>;
  /** Tokens spent in the main thread with no skill attributed to them. */
  unattributed: TokenTotals;
  /** Tokens spent inside subagent transcripts that could not be tied to an Agent call. */
  unlinkedSubagent: TokenTotals;
  totals: TokenTotals;
}

export const emptyTotals = (): TokenTotals => ({
  input: 0,
  output: 0,
  cacheCreate: 0,
  cacheRead: 0,
  total: 0,
});

export const costKey = (kind: string, name: string): string => `${kind}:${name}`;

function add(target: TokenTotals, event: Extract<SessionEvent, { kind: 'usage' }>): void {
  target.input += event.input;
  target.output += event.output;
  target.cacheCreate += event.cacheCreate;
  target.cacheRead += event.cacheRead;
  target.total += event.input + event.output + event.cacheCreate;
}

function bucket(map: Map<string, TokenTotals>, key: string): TokenTotals {
  let totals = map.get(key);
  if (!totals) {
    totals = emptyTotals();
    map.set(key, totals);
  }
  return totals;
}

/**
 * `events` must cover whole sessions — main transcripts and their subagent
 * sidechains together: a subagent's tokens live in one file while the `Agent` call
 * that names it lives in another.
 */
export function attributeCost(events: SessionEvent[]): CostModel {
  // toolUseId → subagent name, and agentId → toolUseId, meet at the agent's transcript.
  const nameByToolUse = new Map<string, string>();
  const toolUseByAgentId = new Map<string, string>();
  for (const event of events) {
    if (event.kind === 'subagent' && event.toolUseId) nameByToolUse.set(event.toolUseId, event.name);
    if (event.kind === 'subagent-link') toolUseByAgentId.set(event.linkedAgentId, event.toolUseId);
  }

  const model: CostModel = {
    direct: new Map(),
    unattributed: emptyTotals(),
    unlinkedSubagent: emptyTotals(),
    totals: emptyTotals(),
  };

  for (const event of events) {
    if (event.kind !== 'usage') continue;
    add(model.totals, event);

    if (event.agentId) {
      const toolUseId = toolUseByAgentId.get(event.agentId);
      const name = toolUseId === undefined ? undefined : nameByToolUse.get(toolUseId);
      if (name) add(bucket(model.direct, costKey('agent', name)), event);
      else add(model.unlinkedSubagent, event);
      continue;
    }

    if (event.attributionSkill) {
      add(bucket(model.direct, costKey('skill', event.attributionSkill)), event);
      continue;
    }

    add(model.unattributed, event);
  }

  return model;
}

const FRONTMATTER_DESCRIPTION = /^description:\s*(.*)$/im;

/**
 * Context cost of merely having a component installed: its description sits in the
 * system prompt of every session. An estimate — `chars / 4` is the usual rule of
 * thumb, and no transcript records it to check against.
 */
export function estimateOverheadTokens(component: InstalledComponent, sessions: number): number {
  if (component.kind === 'hook' || component.kind === 'mcp') return 0;
  const chars = descriptionChars(component.path) + component.name.length;
  return Math.round((chars / 4) * Math.max(sessions, 0));
}

const descriptionCache = new Map<string, number>();

function descriptionChars(file: string): number {
  const cached = descriptionCache.get(file);
  if (cached !== undefined) return cached;

  let chars = 0;
  try {
    // Frontmatter lives in the first few hundred bytes; the body is irrelevant here.
    const head = fs.readFileSync(file, 'utf8').slice(0, 4000);
    chars = FRONTMATTER_DESCRIPTION.exec(head)?.[1]?.trim().length ?? 0;
  } catch {
    chars = 0;
  }
  descriptionCache.set(file, chars);
  return chars;
}
