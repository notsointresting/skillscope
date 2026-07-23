/**
 * `--csv`, for spreadsheets and other tabular consumers.
 */
import type { Report } from '../load.js';

function escapeCsv(value: string | number | undefined): string {
  const text = value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** `doctor --csv` — findings are already a flat table, so they map directly. */
export function renderFindingsCsv(
  findings: { check: string; subject: string; detail: string; fix?: string }[],
): string {
  return [
    ['check', 'subject', 'detail', 'fix'],
    ...findings.map((finding) => [finding.check, finding.subject, finding.detail, finding.fix]),
  ]
    .map((row) => row.map(escapeCsv).join(','))
    .join('\n');
}

export function renderCsv(report: Pick<Report, 'used' | 'untracked'>): string {
  const rows = [...report.used, ...report.untracked];
  return [
    ['kind', 'name', 'fires', 'sessions', 'tokens', 'first fired', 'last fired'],
    ...rows.map((usage) => [
      usage.kind,
      usage.name,
      usage.fires,
      usage.sessions,
      usage.tokens.total,
      usage.firstFired,
      usage.lastFired,
    ]),
  ]
    .map((row) => row.map(escapeCsv).join(','))
    .join('\n');
}
