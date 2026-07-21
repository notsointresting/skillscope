/**
 * `--json`, for scripting. Stable shape: adding fields is fine, renaming is not.
 * Maps do not survive JSON.stringify, so they are flattened explicitly.
 */
import type { ComponentUsage } from '../analyze/attribute.js';
import type { TokenTotals } from '../analyze/cost.js';
import type { Report } from '../load.js';

interface JsonComponent {
  kind: string;
  name: string;
  installed: boolean;
  source?: string;
  plugin?: string;
  path?: string;
  fires: number;
  sessions: number;
  projects: number;
  firstFired?: string;
  lastFired?: string;
  tokens: TokenTotals;
  overheadTokens: number;
}

const toJsonComponent = (usage: ComponentUsage): JsonComponent => ({
  kind: usage.kind,
  name: usage.name,
  installed: usage.installed !== undefined,
  ...(usage.installed ? { source: usage.installed.source, path: usage.installed.path } : {}),
  ...(usage.installed?.plugin ? { plugin: usage.installed.plugin } : {}),
  fires: usage.fires,
  sessions: usage.sessions,
  projects: usage.projects,
  ...(usage.firstFired ? { firstFired: usage.firstFired } : {}),
  ...(usage.lastFired ? { lastFired: usage.lastFired } : {}),
  tokens: usage.tokens,
  overheadTokens: usage.overheadTokens,
});

export function renderJson(report: Report): string {
  return JSON.stringify(
    {
      generatedBy: 'skillscope',
      claudeDir: report.dirs.root,
      sessions: report.sessions,
      projects: report.projects,
      transcriptLines: report.stats.lines,
      malformedLines: report.stats.malformed,
      unknownEntryTypes: report.unknownTypes,
      used: report.used.map(toJsonComponent),
      untracked: report.untracked.map(toJsonComponent),
      dead: report.dead.map((component) => ({
        kind: component.kind,
        name: component.name,
        source: component.source,
        path: component.path,
        ...(component.plugin ? { plugin: component.plugin } : {}),
        ...(component.enabled === undefined ? {} : { enabled: component.enabled }),
      })),
      tokens: {
        measuredTotal: report.cost.totals,
        unattributed: report.cost.unattributed,
        unlinkedSubagent: report.cost.unlinkedSubagent,
      },
    },
    null,
    2,
  );
}
