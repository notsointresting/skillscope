/**
 * The wrapped card: one self-contained SVG, no native deps, no fonts fetched.
 * Takes plain numbers rather than a full Report so it is trivial to test.
 */
import type { CardTheme } from './themes/index.js';

export interface CardStat {
  name: string;
  fires: number;
}

export interface CardStats {
  /** Human label: "All time", "July 2026". */
  period: string;
  sessions: number;
  /** Measured tokens over the period. */
  tokens: number;
  topSkill?: CardStat;
  topAgent?: CardStat;
  /** Fired component with the fewest fires — the rare catch. */
  rarestSkill?: CardStat;
  installed: number;
  dead: number;
  /** Longest run of consecutive active days. */
  streak: number;
  /** Weekday most active days fall on, e.g. "Tuesday". */
  busiestDay?: string;
}

/** Longest run of consecutive `YYYY-MM-DD` days. Input need not be sorted. */
export function longestStreak(days: string[]): number {
  if (days.length === 0) return 0;
  const sorted = [...new Set(days)].sort();
  let best = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    const previous = Date.parse(`${sorted[i - 1]}T00:00:00Z`);
    const current = Date.parse(`${sorted[i]}T00:00:00Z`);
    if (current - previous === 86_400_000) {
      run++;
      if (run > best) best = run;
    } else {
      run = 1;
    }
  }
  return best;
}

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

/** The weekday most active days fall on, e.g. "Tuesday". Undefined when there
 * are no active days. Ties break toward the earlier weekday (Sun..Sat). */
export function busiestDay(days: string[]): string | undefined {
  if (days.length === 0) return undefined;
  const counts = new Array<number>(7).fill(0);
  for (const day of days) {
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
    if (!Number.isNaN(weekday)) counts[weekday] = (counts[weekday] ?? 0) + 1;
  }
  let best = 0;
  for (let i = 1; i < 7; i++) if (counts[i]! > counts[best]!) best = i;
  return counts[best]! > 0 ? WEEKDAYS[best] : undefined;
}

function escapeXml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** 171_234_567 -> "171.2M". Big numbers must fit the card, not impress it. */
export function compact(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}

const WIDTH = 720;
const HEIGHT = 420;
const FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

export function renderCard(stats: CardStats, theme: CardTheme): string {
  const name = (stat: CardStat | undefined): string =>
    stat ? escapeXml(truncate(stat.name, 34)) : '—';
  const fires = (stat: CardStat | undefined): string =>
    stat ? `${compact(stat.fires)}×` : '';

  const rows: Array<[label: string, value: string, detail: string]> = [
    ['Top skill', name(stats.topSkill), fires(stats.topSkill)],
    ['Top subagent', name(stats.topAgent), fires(stats.topAgent)],
    ['Rarest catch', name(stats.rarestSkill), fires(stats.rarestSkill)],
  ];

  const deadLine =
    stats.installed > 0
      ? `${compact(stats.dead)} of ${compact(stats.installed)} installed never fired`
      : 'nothing installed yet';
  const streakLine = [
    stats.streak > 0 ? `${stats.streak}-day streak` : '',
    stats.busiestDay ? `busiest ${stats.busiestDay}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const empty = stats.sessions === 0;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="SkillScope Wrapped">
  <rect width="${WIDTH}" height="${HEIGHT}" rx="16" fill="${theme.bg}"/>
  <text x="40" y="58" font-family="${FONT}" font-size="26" font-weight="700" fill="${theme.fg}">SkillScope Wrapped</text>
  <text x="${WIDTH - 40}" y="58" text-anchor="end" font-family="${FONT}" font-size="15" fill="${theme.muted}">${escapeXml(stats.period)}</text>

  <text x="40" y="140" font-family="${FONT}" font-size="46" font-weight="700" fill="${theme.accent}">${compact(stats.sessions)}</text>
  <text x="40" y="164" font-family="${FONT}" font-size="13" fill="${theme.muted}">sessions</text>
  <text x="240" y="140" font-family="${FONT}" font-size="46" font-weight="700" fill="${theme.accent}">${compact(stats.tokens)}</text>
  <text x="240" y="164" font-family="${FONT}" font-size="13" fill="${theme.muted}">tokens measured</text>

  <rect x="32" y="188" width="${WIDTH - 64}" height="150" rx="12" fill="${theme.panel}"/>
${
  empty
    ? `  <text x="52" y="266" font-family="${FONT}" font-size="16" fill="${theme.muted}">No activity in this period yet — the card fills itself in as you work.</text>`
    : rows
        .map(
          ([label, value, detail], i) =>
            `  <text x="52" y="${228 + i * 44}" font-family="${FONT}" font-size="13" fill="${theme.muted}">${label}</text>
  <text x="200" y="${228 + i * 44}" font-family="${FONT}" font-size="17" fill="${theme.fg}">${value}</text>
  <text x="${WIDTH - 52}" y="${228 + i * 44}" text-anchor="end" font-family="${FONT}" font-size="15" fill="${theme.accent}">${detail}</text>`,
        )
        .join('\n')
}

  <text x="40" y="376" font-family="${FONT}" font-size="14" fill="${theme.fg}">${escapeXml(deadLine)}</text>
  <text x="${WIDTH - 40}" y="376" text-anchor="end" font-family="${FONT}" font-size="14" fill="${theme.accent}">${escapeXml(streakLine)}</text>
  <text x="40" y="402" font-family="${FONT}" font-size="12" fill="${theme.muted}">cc-skillscope · everything stays on your machine</text>
</svg>
`;
}
