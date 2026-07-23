/**
 * `doctor --json` / `--md` / `--csv`. Driven off a fixed Finding list so the
 * renderers are checked directly, independent of what discovery happens to find.
 */
import { describe, expect, it } from 'vitest';

import { renderDoctorJson, renderDoctorMarkdown, type Finding } from '../src/doctor.js';
import { renderFindingsCsv } from '../src/render/csv.js';

const FINDINGS: Finding[] = [
  {
    check: 'description-length',
    subject: 'verbose-skill',
    detail: '/home/x/.claude/skills/verbose.md has a 1200-character description',
    fix: 'shorten the description to a line or two',
  },
  // No `fix`, and a pipe in the detail — both are the interesting edges.
  {
    check: 'orphaned-plugin',
    subject: 'ghost | plugin',
    detail: 'registered but the install path is gone',
  },
];

describe('doctor --json', () => {
  it('emits the finding list with a count', () => {
    const parsed = JSON.parse(renderDoctorJson(FINDINGS)) as {
      generatedBy: string;
      findingCount: number;
      findings: { check: string; subject: string; detail: string; fix?: string }[];
    };

    expect(parsed.generatedBy).toBe('skillscope');
    expect(parsed.findingCount).toBe(2);
    expect(parsed.findings).toHaveLength(2);
    expect(parsed.findings[0]?.check).toBe('description-length');
    expect(parsed.findings[0]?.fix).toBe('shorten the description to a line or two');
    // fix is omitted, not null, when absent.
    expect(parsed.findings[1]).not.toHaveProperty('fix');
  });

  it('emits a healthy install as an empty list, not an error', () => {
    const parsed = JSON.parse(renderDoctorJson([])) as {
      findingCount: number;
      findings: unknown[];
    };
    expect(parsed.findingCount).toBe(0);
    expect(parsed.findings).toEqual([]);
  });
});

describe('doctor --md', () => {
  it('renders a table row per finding', () => {
    const md = renderDoctorMarkdown(FINDINGS);
    expect(md).toContain('# SkillScope doctor');
    expect(md).toContain('2 findings.');
    expect(md).toContain('| Check | Subject | Detail | Fix |');
    expect(md).toContain('description-length');
    // A missing fix renders as a dash rather than an empty cell.
    expect(md).toContain('| — |');
  });

  it('escapes a pipe so it cannot split the row into phantom columns', () => {
    const md = renderDoctorMarkdown(FINDINGS);
    expect(md).toContain('ghost \\| plugin');
    // Every table row must have the same column count as the header.
    const rows = md.split('\n').filter((line) => line.startsWith('|'));
    const columns = rows.map((row) => row.split(/(?<!\\)\|/).length);
    expect(new Set(columns).size).toBe(1);
  });

  it('says so when there is nothing to report', () => {
    expect(renderDoctorMarkdown([])).toContain('Everything looks healthy');
  });
});

describe('doctor --csv', () => {
  it('emits a header plus one row per finding', () => {
    const lines = renderFindingsCsv(FINDINGS).split('\n');
    expect(lines[0]).toBe('check,subject,detail,fix');
    expect(lines).toHaveLength(3);
    // An absent fix is an empty trailing field.
    expect(lines[2]?.endsWith(',')).toBe(true);
  });

  it('emits just the header for a healthy install', () => {
    expect(renderFindingsCsv([])).toBe('check,subject,detail,fix');
  });
});
