/**
 * Join what is installed against what actually fired.
 *
 * Three groups come out of it:
 *   used      — installed and fired
 *   dead      — installed, never fired (the headline number)
 *   untracked — fired but not found on disk: builtin agents like `Explore`,
 *               skills from a plugin since uninstalled. Reported, never called dead.
 */
import type { ComponentKind, InstalledComponent } from '../discovery/installed.js';
import type { SessionEvent } from '../parser/schema.js';
import {
  attributeCost,
  costKey,
  emptyTotals,
  estimateOverheadTokens,
  type CostModel,
  type TokenTotals,
} from './cost.js';

export interface ComponentUsage {
  kind: ComponentKind;
  name: string;
  /** Absent when the component fired but is no longer installed. */
  installed?: InstalledComponent;
  fires: number;
  sessions: number;
  projects: number;
  /** ISO-8601 UTC, as recorded in the transcript. */
  firstFired?: string;
  lastFired?: string;
  /** Measured tokens. Zero for hooks and MCP servers: no usage is stamped with them. */
  tokens: TokenTotals;
  /** Estimated system-prompt cost of having it installed at all. */
  overheadTokens: number;
}

export interface Attribution {
  used: ComponentUsage[];
  dead: InstalledComponent[];
  untracked: ComponentUsage[];
  sessions: number;
  projects: number;
  /** Distinct `YYYY-MM-DD` days with any activity, ascending. Streaks are built from this. */
  activeDays: string[];
  cost: CostModel;
}

interface Tally {
  fires: number;
  sessions: Set<string>;
  projects: Set<string>;
  first?: string;
  last?: string;
}

/** How a fired event names the component it belongs to. */
function identify(event: SessionEvent): { kind: ComponentKind; name: string } | undefined {
  switch (event.kind) {
    case 'skill':
      return { kind: 'skill', name: event.name };
    case 'subagent':
      return { kind: 'agent', name: event.name };
    case 'hook':
      return { kind: 'hook', name: event.command };
    case 'tool':
      return event.mcpServer ? { kind: 'mcp', name: event.mcpServer } : undefined;
    default:
      return undefined;
  }
}

export function attribute(events: SessionEvent[], installed: InstalledComponent[]): Attribution {
  const tallies = new Map<string, Tally>();
  const sessions = new Set<string>();
  const projects = new Set<string>();
  const days = new Set<string>();

  for (const event of events) {
    if (event.sessionId) sessions.add(event.sessionId);
    if (event.project) projects.add(event.project);
    if (event.timestamp) days.add(event.timestamp.slice(0, 10));

    const identity = identify(event);
    if (!identity) continue;

    const key = costKey(identity.kind, identity.name);
    let tally = tallies.get(key);
    if (!tally) {
      tally = { fires: 0, sessions: new Set(), projects: new Set() };
      tallies.set(key, tally);
    }
    tally.fires++;
    if (event.sessionId) tally.sessions.add(event.sessionId);
    if (event.project) tally.projects.add(event.project);
    if (event.timestamp) {
      // ISO-8601 UTC sorts lexicographically, so a string compare is enough.
      if (!tally.first || event.timestamp < tally.first) tally.first = event.timestamp;
      if (!tally.last || event.timestamp > tally.last) tally.last = event.timestamp;
    }
  }

  const cost = attributeCost(events);
  const sessionCount = sessions.size;
  const byKey = new Map(installed.map((c) => [costKey(c.kind, c.name), c]));

  const used: ComponentUsage[] = [];
  const untracked: ComponentUsage[] = [];

  for (const [key, tally] of tallies) {
    const component = byKey.get(key);
    const separator = key.indexOf(':');
    const usage: ComponentUsage = {
      kind: (component?.kind ?? key.slice(0, separator)) as ComponentKind,
      name: component?.name ?? key.slice(separator + 1),
      ...(component ? { installed: component } : {}),
      fires: tally.fires,
      sessions: tally.sessions.size,
      projects: tally.projects.size,
      ...(tally.first ? { firstFired: tally.first } : {}),
      ...(tally.last ? { lastFired: tally.last } : {}),
      tokens: cost.direct.get(key) ?? emptyTotals(),
      overheadTokens: component ? estimateOverheadTokens(component, sessionCount) : 0,
    };
    (component ? used : untracked).push(usage);
  }

  const fired = new Set(tallies.keys());
  const dead = installed.filter((c) => !fired.has(costKey(c.kind, c.name)));

  const byFires = (a: ComponentUsage, b: ComponentUsage): number =>
    b.fires - a.fires || a.name.localeCompare(b.name);

  return {
    used: used.sort(byFires),
    dead,
    untracked: untracked.sort(byFires),
    sessions: sessionCount,
    projects: projects.size,
    activeDays: [...days].sort(),
    cost,
  };
}
