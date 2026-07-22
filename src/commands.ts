/**
 * The commands. They are thin by design: `loadReport` does the work, the
 * renderers do the formatting, and each command only chooses which rows to show.
 *
 * One file rather than the plan's `commands/` directory — four functions of a
 * dozen lines each. Split them out when one grows its own logic (Phase 4's
 * `wrapped`, Phase 5's `doctor`).
 */
import type { ComponentUsage } from './analyze/attribute.js';
import type { Report } from './load.js';
import { busiestDay, longestStreak, renderCard, type CardStat } from './render/card/card.js';
import { themes, type CardTheme } from './render/card/themes/index.js';
import { renderCsv } from './render/csv.js';
import { renderJson } from './render/json.js';
import { renderMarkdown } from './render/markdown.js';
import {
  bold,
  dim,
  num,
  renderEmptyState,
  renderReport,
  renderUsageTable,
  table,
} from './render/terminal.js';

export type Format = 'terminal' | 'json' | 'md' | 'csv';
export type Sort = 'fires' | 'cost' | 'last-used';

export interface ViewOptions {
  format: Format;
  sort: Sort;
  /** Show what never fired instead of what did. */
  dead?: boolean;
  /** Show what fired but is not installed. */
  untracked?: boolean;
}

const sorters: Record<Sort, (a: ComponentUsage, b: ComponentUsage) => number> = {
  fires: (a, b) => b.fires - a.fires || a.name.localeCompare(b.name),
  cost: (a, b) => b.tokens.total - a.tokens.total || a.name.localeCompare(b.name),
  'last-used': (a, b) => (b.lastFired ?? '').localeCompare(a.lastFired ?? ''),
};

export function report(loaded: Report, options: ViewOptions): string {
  if (options.format === 'csv') return renderCsv(loaded);
  if (options.format === 'json') return renderJson(loaded);
  if (options.format === 'md') return renderMarkdown(loaded);
  return renderReport(loaded);
}

/** `skillscope skills` / `skillscope agents` — same view, different kind. */
export function componentView(
  loaded: Report,
  kind: ComponentUsage['kind'],
  options: ViewOptions,
): string {
  if (options.format === 'csv') return renderCsv(filterReport(loaded, kind));
  if (options.format === 'json') return renderJson(filterReport(loaded, kind));
  if (options.format === 'md') return renderMarkdown(filterReport(loaded, kind));
  if (!loaded.dirs.exists) return renderEmptyState(loaded);

  const label = kind === 'skill' ? 'Skills' : kind === 'agent' ? 'Subagents' : kind;

  if (options.dead) {
    const dead = loaded.dead.filter((c) => c.kind === kind);
    return [
      bold(`${label} that have never fired: ${num(dead.length)}`),
      table(dead, [
        { header: 'component', value: (c) => c.name, max: 50 },
        { header: 'source', value: (c) => c.source },
        { header: 'plugin', value: (c) => c.plugin ?? '—' },
      ]),
    ].join('\n');
  }

  const rows = (options.untracked ? loaded.untracked : loaded.used)
    .filter((u) => u.kind === kind)
    .sort(sorters[options.sort]);

  return [
    bold(
      options.untracked
        ? `${label} that fired but are not installed: ${num(rows.length)}`
        : `${label} in use: ${num(rows.length)}`,
    ),
    renderUsageTable(rows),
    options.untracked
      ? dim('Builtins and components from plugins that were removed both land here.')
      : dim(`Sorted by ${options.sort}. For what never fired: --dead.`),
  ].join('\n');
}

export function cost(loaded: Report, options: ViewOptions): string {
  if (options.format === 'csv') return renderCsv(loaded);
  if (options.format === 'json') return renderJson(loaded);
  if (options.format === 'md') return renderMarkdown(loaded);
  if (!loaded.dirs.exists) return renderEmptyState(loaded);

  const rows = [...loaded.used, ...loaded.untracked]
    .filter((usage) => usage.tokens.total > 0)
    .sort(sorters.cost);

  return [
    bold('Measured tokens by component'),
    table(rows, [
      { header: 'component', value: (u) => u.name, max: 46 },
      { header: 'kind', value: (u) => u.kind },
      { header: 'tokens', value: (u) => num(u.tokens.total), align: 'right' },
      { header: 'cache read', value: (u) => num(u.tokens.cacheRead), align: 'right' },
      { header: 'overhead est.', value: (u) => num(u.overheadTokens), align: 'right' },
    ]),
    '',
    `${bold('Total measured')}     ${num(loaded.cost.totals.total)}`,
    `${bold('Unattributed')}       ${num(loaded.cost.unattributed.total)} ` +
      dim('(turns where no skill was active)'),
    loaded.cost.unlinkedSubagent.total > 0
      ? `${bold('Subagent, unlinked')} ${num(loaded.cost.unlinkedSubagent.total)}`
      : '',
    '',
    dim('Token counts are read from transcripts. "overhead est." is an estimate:'),
    dim('description length / 4, times the number of sessions analyzed.'),
  ]
    .filter((line) => line !== '')
    .join('\n');
}

/** `skillscope wrapped` — the shareable SVG stats card. */
export function wrapped(loaded: Report, period: string, themeName: string): string {
  const theme: CardTheme | undefined = themes[themeName];
  if (!theme) {
    throw new Error(`Unknown theme: ${themeName} (available: ${Object.keys(themes).join(', ')})`);
  }

  const stat = (usage: ComponentUsage | undefined): CardStat | undefined =>
    usage ? { name: usage.name, fires: usage.fires } : undefined;
  const skills = loaded.used.filter((u) => u.kind === 'skill');
  const agents = loaded.used.filter((u) => u.kind === 'agent');
  // used is already sorted by fires desc; the rarest is the tail.
  const rarest = skills.length > 1 ? skills[skills.length - 1] : undefined;

  return renderCard(
    {
      period,
      sessions: loaded.sessions,
      tokens: loaded.cost.totals.total,
      ...(stat(skills[0]) ? { topSkill: stat(skills[0]) } : {}),
      ...(stat(agents[0]) ? { topAgent: stat(agents[0]) } : {}),
      ...(stat(rarest) ? { rarestSkill: stat(rarest) } : {}),
      installed: loaded.used.filter((u) => u.installed).length + loaded.dead.length,
      dead: loaded.dead.length,
      streak: longestStreak(loaded.activeDays),
      ...(busiestDay(loaded.activeDays) ? { busiestDay: busiestDay(loaded.activeDays) } : {}),
    },
    theme,
  );
}

function filterReport(loaded: Report, kind: ComponentUsage['kind']): Report {
  return {
    ...loaded,
    used: loaded.used.filter((u) => u.kind === kind),
    untracked: loaded.untracked.filter((u) => u.kind === kind),
    dead: loaded.dead.filter((c) => c.kind === kind),
  };
}
