/**
 * `skillscope doctor` — config sanity checks over what discovery found.
 *
 * Strictly read-only: it reports and suggests shell commands, it never edits
 * anything under ~/.claude itself. Findings are about components, not the user.
 */
import fs from 'node:fs';
import path from 'node:path';

import { isDirectory, readJson, type ClaudeDirs } from './discovery/claude-dirs.js';
import type { InstalledComponent } from './discovery/installed.js';

export interface Finding {
  check: string;
  subject: string;
  detail: string;
  fix?: string;
}

interface InstalledPluginsFile {
  plugins?: Record<string, { installPath?: string; version?: string }[]>;
}

export function diagnose(dirs: ClaudeDirs, installed: InstalledComponent[]): Finding[] {
  return [
    ...frontmatterFindings(installed),
    ...longDescriptionFindings(installed),
    ...duplicateFindings(installed),
    ...unavailableMcpFindings(installed),
    ...wrongDirFindings(dirs),
    ...orphanedPluginFindings(dirs),
  ];
}

/** Above this, a description is worth a nudge to trim. */
const LONG_DESCRIPTION = 1000;

/**
 * Every installed skill/agent has its `description:` loaded into context every
 * session, so a very long one is a standing token cost. Flag the outliers.
 */
function longDescriptionFindings(installed: InstalledComponent[]): Finding[] {
  const findings: Finding[] = [];
  for (const component of installed) {
    if (component.kind !== 'skill' && component.kind !== 'agent') continue;
    const head = readHead(component.path);
    if (head === undefined) continue;
    const description = frontmatterDescription(head);
    if (description !== undefined && description.length > LONG_DESCRIPTION) {
      findings.push({
        check: 'description-length',
        subject: component.name,
        detail: `${component.path} has a ${description.length}-character description — it is loaded into context every session`,
        fix: `shorten the description to a line or two (aim for under ${LONG_DESCRIPTION} characters)`,
      });
    }
  }
  return findings;
}

/**
 * The `description:` value from a frontmatter head, including a block scalar
 * (`>`/`|`) that continues onto more-indented lines. Undefined when there is no
 * frontmatter or no description key.
 */
function frontmatterDescription(head: string): string | undefined {
  if (!head.startsWith('---')) return undefined;
  const closing = head.indexOf('\n---', 3);
  const block = closing === -1 ? head : head.slice(0, closing);
  const lines = block.split('\n');
  const start = lines.findIndex((line) => /^description\s*:/.test(line));
  if (start === -1) return undefined;

  const first = lines[start]!.replace(/^description\s*:/, '').trim();
  const isBlockScalar = /^[>|][+-]?\d*$/.test(first);
  const parts = isBlockScalar ? [] : [first];

  // Collect continuation lines: anything indented deeper than the key belongs to
  // it (block-scalar body); a line at the key's indent or less is the next key.
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === '') continue;
    if (!/^\s/.test(line)) break;
    parts.push(line.trim());
  }

  return parts
    .join(' ')
    .replace(/^["']|["']$/g, '')
    .trim();
}

/** Skills and agents need YAML frontmatter with a description, or they never trigger. */
function frontmatterFindings(installed: InstalledComponent[]): Finding[] {
  const findings: Finding[] = [];
  for (const component of installed) {
    if (component.kind !== 'skill' && component.kind !== 'agent') continue;
    const head = readHead(component.path);
    if (head === undefined) continue;
    if (!head.startsWith('---')) {
      findings.push({
        check: 'frontmatter',
        subject: component.name,
        detail: `${component.path} does not start with a YAML frontmatter block`,
        fix: 'add `---` frontmatter with `name:` and `description:` at the top of the file',
      });
    } else if (!/^description\s*:/m.test(head)) {
      findings.push({
        check: 'frontmatter',
        subject: component.name,
        detail: `${component.path} has frontmatter but no description — Claude cannot decide when to use it`,
        fix: 'add a one-line `description:` to the frontmatter',
      });
    }
  }
  return findings;
}

/** The same name reachable from two places: one of them silently wins. */
function duplicateFindings(installed: InstalledComponent[]): Finding[] {
  const byName = new Map<string, InstalledComponent[]>();
  for (const component of installed) {
    if (component.kind === 'hook') continue; // identical hook commands are normal across settings files
    const key = `${component.kind} ${component.name}`;
    byName.set(key, [...(byName.get(key) ?? []), component]);
  }
  const findings: Finding[] = [];
  for (const [key, components] of byName) {
    const paths = new Set(components.map((c) => c.path));
    if (paths.size < 2) continue;
    findings.push({
      check: 'shadowing',
      subject: key,
      detail: `defined in ${paths.size} places: ${[...paths].join(', ')}`,
      fix: 'remove or rename all but the one you mean to keep',
    });
  }
  return findings;
}

/** Agents that list `mcp__server__*` tools for servers that are not configured. */
function unavailableMcpFindings(installed: InstalledComponent[]): Finding[] {
  const servers = new Set(installed.filter((c) => c.kind === 'mcp').map((c) => c.name));
  const findings: Finding[] = [];
  for (const component of installed) {
    if (component.kind !== 'agent') continue;
    const head = readHead(component.path);
    if (head === undefined) continue;
    const missing = new Set<string>();
    for (const match of head.matchAll(/mcp__([A-Za-z0-9-]+)__/g)) {
      const server = match[1];
      if (server !== undefined && !servers.has(server)) missing.add(server);
    }
    if (missing.size > 0) {
      findings.push({
        check: 'mcp-tools',
        subject: component.name,
        detail: `references MCP server(s) not configured here: ${[...missing].join(', ')}`,
        fix: 'add the server to ~/.claude.json, or drop the tool from the agent frontmatter',
      });
    }
  }
  return findings;
}

/** A lone .md in skills/ or a directory in agents/ is installed in the wrong shape. */
function wrongDirFindings(dirs: ClaudeDirs): Finding[] {
  const findings: Finding[] = [];
  for (const entry of readDir(dirs.skills)) {
    if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'SKILL.md') {
      findings.push({
        check: 'wrong-dir',
        subject: entry.name,
        detail: `${path.join(dirs.skills, entry.name)} is a bare .md in skills/ — skills live in <name>/SKILL.md`,
        fix: `mkdir the skill directory and move it to ${entry.name.replace(/\.md$/, '')}/SKILL.md, or move it to agents/ if it is an agent`,
      });
    }
    if (!entry.isFile() && !fs.existsSync(path.join(dirs.skills, entry.name, 'SKILL.md'))) {
      findings.push({
        check: 'wrong-dir',
        subject: entry.name,
        detail: `${path.join(dirs.skills, entry.name)} has no SKILL.md, so it is never loaded`,
        fix: 'add a SKILL.md, or delete the directory',
      });
    }
  }
  for (const entry of readDir(dirs.agents)) {
    if (entry.isDirectory()) {
      findings.push({
        check: 'wrong-dir',
        subject: entry.name,
        detail: `${path.join(dirs.agents, entry.name)} is a directory — agents are single <name>.md files`,
        fix: 'move the agent definition up to agents/<name>.md',
      });
    }
  }
  return findings;
}

/** installed_plugins.json entries whose install path no longer exists. */
function orphanedPluginFindings(dirs: ClaudeDirs): Finding[] {
  const file = path.join(dirs.plugins, 'installed_plugins.json');
  const installed = readJson<InstalledPluginsFile>(file);
  const findings: Finding[] = [];
  for (const [key, entries] of Object.entries(installed?.plugins ?? {})) {
    for (const entry of entries ?? []) {
      if (entry.installPath && !isDirectory(entry.installPath)) {
        findings.push({
          check: 'orphaned-plugin',
          subject: key,
          detail: `registered in installed_plugins.json but ${entry.installPath} is gone`,
          fix: 'reinstall the plugin, or remove its entry from installed_plugins.json',
        });
      }
    }
  }
  return findings;
}

export function renderDoctor(findings: Finding[]): string {
  if (findings.length === 0) {
    return 'doctor: everything looks healthy — no findings.';
  }
  const lines = [`doctor: ${findings.length} finding${findings.length === 1 ? '' : 's'}`, ''];
  for (const finding of findings) {
    lines.push(`[${finding.check}] ${finding.subject}`);
    lines.push(`  ${finding.detail}`);
    if (finding.fix) lines.push(`  fix: ${finding.fix}`);
    lines.push('');
  }
  lines.push('doctor never modifies anything — every fix above is yours to apply.');
  return lines.join('\n');
}

/**
 * `doctor --json`. Stable shape, same contract as the report renderer: adding
 * fields is fine, renaming is not. `fix` is omitted when absent rather than
 * emitted as null, so a consumer can test for the key.
 */
export function renderDoctorJson(findings: Finding[]): string {
  return JSON.stringify(
    {
      generatedBy: 'skillscope',
      findingCount: findings.length,
      findings: findings.map((finding) => ({
        check: finding.check,
        subject: finding.subject,
        detail: finding.detail,
        ...(finding.fix ? { fix: finding.fix } : {}),
      })),
    },
    null,
    2,
  );
}

/** `doctor --md`, for pasting into an issue. */
export function renderDoctorMarkdown(findings: Finding[]): string {
  if (findings.length === 0) {
    return ['# SkillScope doctor', '', 'Everything looks healthy — no findings.'].join('\n');
  }
  // A detail carries file paths and a fix carries shell commands; either could
  // hold a pipe, which would otherwise split the row into phantom columns.
  const cell = (value: string): string => value.replaceAll('|', '\\|');
  return [
    '# SkillScope doctor',
    '',
    `${findings.length} finding${findings.length === 1 ? '' : 's'}.`,
    '',
    '| Check | Subject | Detail | Fix |',
    '| --- | --- | --- | --- |',
    ...findings.map(
      (finding) =>
        `| ${cell(finding.check)} | ${cell(finding.subject)} | ${cell(finding.detail)} | ` +
        `${finding.fix ? cell(finding.fix) : '—'} |`,
    ),
    '',
    '_doctor never modifies anything — every fix above is yours to apply._',
  ].join('\n');
}

function readHead(file: string): string | undefined {
  try {
    return fs.readFileSync(file, 'utf8').slice(0, 4096);
  } catch {
    return undefined;
  }
}

function readDir(dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}
