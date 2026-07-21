/**
 * `--md`, for pasting into an issue or a README. Plain GitHub-flavoured tables.
 */
import type { ComponentUsage } from '../analyze/attribute.js';
import type { Report } from '../load.js';
import { num, shortDate } from './terminal.js';

const row = (cells: (string | number)[]): string => `| ${cells.join(' | ')} |`;

function usageTable(rows: ComponentUsage[]): string {
  if (rows.length === 0) return '_Nothing yet._';
  return [
    row(['Component', 'Fires', 'Sessions', 'Tokens', 'Last used']),
    row(['---', '---:', '---:', '---:', '---']),
    ...rows.map((usage) =>
      row([
        usage.name,
        num(usage.fires),
        num(usage.sessions),
        num(usage.tokens.total),
        shortDate(usage.lastFired),
      ]),
    ),
  ].join('\n');
}

export function renderMarkdown(report: Report): string {
  const installedCount = report.used.length + report.dead.length;
  const skills = report.used.filter((u) => u.kind === 'skill');
  const agents = report.used.filter((u) => u.kind === 'agent');

  return [
    '# SkillScope report',
    '',
    `- Sessions analyzed: **${num(report.sessions)}** across ${num(report.projects)} projects`,
    `- Components installed: **${num(installedCount)}**`,
    `- Fired at least once: **${num(report.used.length)}**`,
    `- Never fired: **${num(report.dead.length)}**`,
    `- Measured tokens: **${num(report.cost.totals.total)}** ` +
      `(${num(report.cost.unattributed.total)} with no skill active)`,
    '',
    '## Skills',
    '',
    usageTable(skills),
    '',
    '## Subagents',
    '',
    usageTable(agents),
    '',
    '## Never fired',
    '',
    report.dead.length === 0
      ? '_Everything installed has fired at least once._'
      : [
          row(['Component', 'Kind', 'Source']),
          row(['---', '---', '---']),
          ...report.dead.map((c) => row([c.name, c.kind, c.source])),
        ].join('\n'),
    '',
    '---',
    '',
    '_Token figures are measured from transcripts, not estimated. ' +
      'Overhead figures, where shown, are estimates._',
  ].join('\n');
}
