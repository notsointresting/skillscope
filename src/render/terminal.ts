/**
 * Terminal output. No colour library: `NO_COLOR`, a non-TTY pipe and a handful of
 * ANSI codes are the whole requirement, and a zero-dependency CLI starts faster.
 */
import type { ComponentUsage } from '../analyze/attribute.js';
import type { Report } from '../load.js';

const useColor =
  !process.env['NO_COLOR'] && process.stdout.isTTY === true && process.env['TERM'] !== 'dumb';

const wrap =
  (open: string, close: string) =>
  (text: string): string =>
    useColor ? `[${open}m${text}[${close}m` : text;

export const bold = wrap('1', '22');
export const dim = wrap('2', '22');
export const green = wrap('32', '39');
export const yellow = wrap('33', '39');
export const cyan = wrap('36', '39');

/** Locale is pinned: the machine default groups digits differently in some regions. */
export const num = (value: number): string => value.toLocaleString('en-US');

export const shortDate = (iso?: string): string => (iso ? (iso.split('T')[0] ?? '—') : '—');

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(max - 1, 1))}…`;
}

export interface Column<T> {
  header: string;
  value: (row: T) => string;
  align?: 'left' | 'right';
  max?: number;
}

export function table<T>(rows: T[], columns: Column<T>[]): string {
  if (rows.length === 0) return dim('  (nothing yet)');

  const cells = rows.map((row) =>
    columns.map((column) => truncate(column.value(row), column.max ?? 60)),
  );
  const widths = columns.map((column, index) =>
    Math.max(column.header.length, ...cells.map((row) => row[index]?.length ?? 0)),
  );

  const line = (values: string[], style: (s: string) => string = (s) => s): string =>
    '  ' +
    values
      .map((value, index) => {
        const width = widths[index] ?? 0;
        return style(
          columns[index]?.align === 'right' ? value.padStart(width) : value.padEnd(width),
        );
      })
      .join('  ')
      .trimEnd();

  return [
    line(
      columns.map((c) => c.header),
      dim,
    ),
    ...cells.map((row) => line(row)),
  ].join('\n');
}

const usageColumns: Column<ComponentUsage>[] = [
  { header: 'component', value: (u) => u.name, max: 46 },
  { header: 'fires', value: (u) => num(u.fires), align: 'right' },
  { header: 'sessions', value: (u) => num(u.sessions), align: 'right' },
  { header: 'tokens', value: (u) => num(u.tokens.total), align: 'right' },
  { header: 'last used', value: (u) => shortDate(u.lastFired) },
];

export function renderUsageTable(rows: ComponentUsage[]): string {
  return table(rows, usageColumns);
}

export function renderReport(report: Report): string {
  if (!report.dirs.exists) return renderEmptyState(report);

  const installedCount = report.used.length + report.dead.length;
  const skills = report.used.filter((u) => u.kind === 'skill');
  const agents = report.used.filter((u) => u.kind === 'agent');
  const byTokens = [...report.used].sort((a, b) => b.tokens.total - a.tokens.total).slice(0, 10);

  const lines = [
    bold('SkillScope'),
    dim(
      `${num(report.sessions)} sessions · ${num(report.projects)} projects · ` +
        `${num(report.stats.lines)} transcript lines`,
    ),
    '',
    bold(`Fired at least once: ${num(report.used.length)} of ${num(installedCount)} installed`),
    report.dead.length > 0
      ? yellow(`Never fired: ${num(report.dead.length)}  `) + dim('(skillscope skills --dead)')
      : green('Everything installed has fired at least once.'),
    '',
    bold('Top skills'),
    renderUsageTable(skills.slice(0, 10)),
    '',
    bold('Top subagents'),
    renderUsageTable(agents.slice(0, 10)),
    '',
    bold('Most expensive (measured tokens)'),
    renderUsageTable(byTokens),
    '',
    bold('Tokens'),
    `  measured total     ${num(report.cost.totals.total)}`,
    `  unattributed       ${num(report.cost.unattributed.total)} ${dim('(no skill was active)')}`,
    report.cost.unlinkedSubagent.total > 0
      ? `  subagent, unlinked ${num(report.cost.unlinkedSubagent.total)}`
      : '',
    '',
    report.untracked.length > 0
      ? dim(
          `${num(report.untracked.length)} components fired that are not installed ` +
            `(builtins, or removed plugins) — skillscope skills --untracked`,
        )
      : '',
    report.stats.malformed > 0
      ? dim(`${num(report.stats.malformed)} unreadable transcript lines were skipped`)
      : '',
    report.unknownTypes.length > 0
      ? dim(`unrecognised transcript entries: ${report.unknownTypes.join(', ')}`)
      : '',
  ];

  return lines.filter((line) => line !== '').join('\n');
}

export function renderEmptyState(report: Report): string {
  return [
    bold('SkillScope found no Claude Code history to read.'),
    '',
    `Looked in: ${report.dirs.root}`,
    '',
    'That is expected if Claude Code has not run on this machine, or if its',
    'config lives elsewhere. Point at another location with:',
    '',
    cyan('  CLAUDE_CONFIG_DIR=/path/to/.claude skillscope'),
    '',
    dim('Nothing was read, written or sent anywhere.'),
  ].join('\n');
}
