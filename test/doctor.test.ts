/**
 * Doctor checks, each against a purpose-built broken install in a temp dir.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { findClaudeDirs } from '../src/discovery/claude-dirs.js';
import type { InstalledComponent } from '../src/discovery/installed.js';
import { diagnose, renderDoctor } from '../src/doctor.js';

let home: string;

const GOOD = '---\nname: fine\ndescription: does a thing\n---\n\nBody.\n';

function write(relative: string, content: string): void {
  const file = path.join(home, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

beforeEach(() => {
  home = mkdtempSync(path.join(os.tmpdir(), 'skillscope-doctor-'));
  mkdirSync(path.join(home, '.claude'), { recursive: true });
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const dirs = () => findClaudeDirs(home);

describe('diagnose', () => {
  it('reports nothing on a healthy install', () => {
    write('.claude/skills/fine/SKILL.md', GOOD);
    write('.claude/agents/helper.md', GOOD);
    const findings = diagnose(dirs(), []);
    expect(findings).toEqual([]);
    expect(renderDoctor(findings)).toContain('everything looks healthy');
  });

  it('flags a skill without frontmatter and one without a description', () => {
    write('.claude/skills/naked/SKILL.md', 'Just prose, no frontmatter.\n');
    write('.claude/skills/mute/SKILL.md', '---\nname: mute\n---\n');
    const installed: InstalledComponent[] = [
      { kind: 'skill', name: 'naked', source: 'user', path: path.join(home, '.claude/skills/naked/SKILL.md') },
      { kind: 'skill', name: 'mute', source: 'user', path: path.join(home, '.claude/skills/mute/SKILL.md') },
    ];
    const checks = diagnose(dirs(), installed).filter((f) => f.check === 'frontmatter');
    expect(checks).toHaveLength(2);
    expect(checks[0]?.detail).toContain('does not start with a YAML frontmatter block');
    expect(checks[1]?.detail).toContain('no description');
  });

  it('flags the same name defined in two places', () => {
    const installed: InstalledComponent[] = [
      { kind: 'skill', name: 'dup', source: 'user', path: '/home/example/.claude/skills/dup/SKILL.md' },
      { kind: 'skill', name: 'dup', source: 'project', path: '/home/example/project-a/.claude/skills/dup/SKILL.md' },
    ];
    const checks = diagnose(dirs(), installed).filter((f) => f.check === 'shadowing');
    expect(checks).toHaveLength(1);
    expect(checks[0]?.subject).toBe('skill dup');
    expect(checks[0]?.detail).toContain('2 places');
  });

  it('flags an agent whose tools name an unconfigured MCP server', () => {
    write(
      '.claude/agents/reacher.md',
      '---\nname: reacher\ndescription: uses tools\ntools: Read, mcp__ghost-server__lookup\n---\n',
    );
    const installed: InstalledComponent[] = [
      { kind: 'agent', name: 'reacher', source: 'user', path: path.join(home, '.claude/agents/reacher.md') },
      { kind: 'mcp', name: 'real-server', source: 'user', path: 'x' },
    ];
    const checks = diagnose(dirs(), installed).filter((f) => f.check === 'mcp-tools');
    expect(checks).toHaveLength(1);
    expect(checks[0]?.detail).toContain('ghost-server');
  });

  it('flags files installed in the wrong shape', () => {
    write('.claude/skills/stray.md', GOOD); // bare .md in skills/
    mkdirSync(path.join(home, '.claude/skills/hollow'), { recursive: true }); // no SKILL.md
    mkdirSync(path.join(home, '.claude/agents/nested'), { recursive: true }); // dir in agents/
    const checks = diagnose(dirs(), []).filter((f) => f.check === 'wrong-dir');
    expect(checks.map((f) => f.subject).sort()).toEqual(['hollow', 'nested', 'stray.md']);
  });

  it('flags plugins registered but missing on disk', () => {
    write(
      '.claude/plugins/installed_plugins.json',
      JSON.stringify({ plugins: { 'ghost@market': [{ installPath: path.join(home, 'gone') }] } }),
    );
    const checks = diagnose(dirs(), []).filter((f) => f.check === 'orphaned-plugin');
    expect(checks).toHaveLength(1);
    expect(checks[0]?.subject).toBe('ghost@market');
    expect(checks[0]?.fix).toContain('reinstall');
  });
});
