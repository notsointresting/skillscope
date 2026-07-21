/**
 * `--csv`, for spreadsheets and other tabular consumers.
 */
import type { Report } from '../load.js';

function escapeCsv(value: string | number | undefined): string {
  const text = value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
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
