/**
 * Discovery is tested against a throwaway install built in a temp directory:
 * a fixture tree of one-line files would be six more files to keep in sync,
 * and this way the expected inventory sits right next to the assertions.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { findClaudeDirs } from '../src/discovery/claude-dirs.js';
import { findInstalled, type InstalledComponent } from '../src/discovery/installed.js';

let home: string;
let projectPath: string;
let symlinksWork = false;

const write = (file: string, body: string): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
};

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'skillscope-'));
  projectPath = path.join(home, 'proj');
  const claude = path.join(home, '.claude');
  const pluginRoot = path.join(claude, 'plugins', 'cache', 'demo');

  write(path.join(claude, 'skills', 'demo-skill', 'SKILL.md'), '# demo skill\n');
  write(path.join(claude, 'agents', 'demo-agent.md'), '# demo agent\n');
  // A directory without SKILL.md is not a skill.
  fs.mkdirSync(path.join(claude, 'skills', 'not-a-skill'), { recursive: true });

  write(
    path.join(claude, 'settings.json'),
    JSON.stringify({
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'bash user-hook.sh' }] }] },
      enabledPlugins: { 'demo@market': true, 'off@market': false },
    }),
  );

  write(
    path.join(claude, 'plugins', 'installed_plugins.json'),
    JSON.stringify({
      plugins: {
        'demo@market': [{ scope: 'user', installPath: pluginRoot, version: '1.0.0' }],
        'off@market': [{ scope: 'user', installPath: path.join(claude, 'plugins', 'cache', 'off') }],
      },
    }),
  );

  write(path.join(pluginRoot, 'skills', 'plugin-skill', 'SKILL.md'), '# plugin skill\n');
  write(path.join(pluginRoot, 'agents', 'plugin-agent.md'), '# plugin agent\n');
  write(
    path.join(pluginRoot, '.claude-plugin', 'plugin.json'),
    JSON.stringify({
      name: 'demo',
      hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'bash plugin-hook.sh' }] }] },
    }),
  );
  // The disabled plugin is on disk too, and must still be reported — as disabled.
  write(
    path.join(claude, 'plugins', 'cache', 'off', 'skills', 'off-skill', 'SKILL.md'),
    '# off skill\n',
  );

  write(
    path.join(home, '.claude.json'),
    JSON.stringify({
      mcpServers: { 'demo-mcp': { type: 'stdio', command: 'python' } },
      projects: { [projectPath]: { mcpServers: { 'proj-mcp': {} } } },
    }),
  );

  write(path.join(projectPath, '.claude', 'skills', 'project-skill', 'SKILL.md'), '# project\n');

  // Skills are often symlinked in from another tool's directory.
  const external = path.join(home, 'external-skills', 'linked-skill');
  write(path.join(external, 'SKILL.md'), '# linked skill\n');
  try {
    fs.symlinkSync(external, path.join(claude, 'skills', 'linked-skill'), 'junction');
    symlinksWork = true;
  } catch {
    symlinksWork = false; // unprivileged Windows without developer mode
  }
});

afterAll(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

const inventory = (): InstalledComponent[] => findInstalled(findClaudeDirs(home), [projectPath]);

const namesOf = (kind: InstalledComponent['kind']): string[] =>
  inventory()
    .filter((c) => c.kind === kind)
    .map((c) => c.name)
    .sort();

describe('installed components', () => {
  it('names plugin skills the way transcripts do (plugin:skill)', () => {
    const expected = ['demo-skill', 'demo:plugin-skill', 'off:off-skill', 'project-skill'];
    if (symlinksWork) expected.push('linked-skill');
    expect(namesOf('skill')).toEqual(expected.sort());
  });

  it('follows symlinked skills', () => {
    if (!symlinksWork) return;
    expect(namesOf('skill')).toContain('linked-skill');
  });

  it('ignores skill directories without a SKILL.md', () => {
    expect(namesOf('skill')).not.toContain('not-a-skill');
  });

  it('finds user and plugin agents', () => {
    expect(namesOf('agent')).toEqual(['demo-agent', 'demo:plugin-agent'].sort());
  });

  it('identifies hooks by the command transcripts record', () => {
    const hooks = inventory().filter((c) => c.kind === 'hook');
    expect(hooks.map((h) => h.name).sort()).toEqual(['bash plugin-hook.sh', 'bash user-hook.sh']);
    expect(hooks.find((h) => h.name === 'bash user-hook.sh')?.event).toBe('Stop');
    expect(hooks.find((h) => h.name === 'bash plugin-hook.sh')?.source).toBe('plugin');
  });

  it('finds global and per-project MCP servers', () => {
    expect(namesOf('mcp')).toEqual(['demo-mcp', 'proj-mcp']);
  });

  it('records where each component comes from', () => {
    const all = inventory();
    expect(all.find((c) => c.name === 'demo-skill')?.source).toBe('user');
    expect(all.find((c) => c.name === 'project-skill')?.source).toBe('project');

    const pluginSkill = all.find((c) => c.name === 'demo:plugin-skill');
    expect(pluginSkill).toMatchObject({ source: 'plugin', plugin: 'demo', pluginVersion: '1.0.0' });
  });

  it('reports components of a disabled plugin as disabled, not missing', () => {
    expect(inventory().find((c) => c.name === 'off:off-skill')?.enabled).toBe(false);
    expect(inventory().find((c) => c.name === 'demo:plugin-skill')?.enabled).toBe(true);
  });
});

describe('missing installations', () => {
  it('reports an empty inventory instead of throwing', () => {
    const nowhere = findClaudeDirs(path.join(home, 'does-not-exist'));
    expect(nowhere.exists).toBe(false);
    expect(findInstalled(nowhere)).toEqual([]);
  });
});
