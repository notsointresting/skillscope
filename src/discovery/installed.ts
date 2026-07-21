/**
 * What is installed, as opposed to what actually fired.
 *
 * Names are built to match how a component appears in a transcript, because that
 * join is the whole product: a skill installed as
 * `plugins/cache/caveman/caveman/<sha>/skills/caveman/SKILL.md` shows up in
 * transcripts as `caveman:caveman`, and must be recognised as the same thing.
 */
import fs from 'node:fs';
import path from 'node:path';

import { isDirectory, projectClaudeDir, readJson, type ClaudeDirs } from './claude-dirs.js';

export type ComponentKind = 'skill' | 'agent' | 'hook' | 'mcp';
export type ComponentSource = 'user' | 'project' | 'plugin';

export interface InstalledComponent {
  kind: ComponentKind;
  /** As it appears in transcripts: `caveman:caveman`, `Explore`, an MCP server name, a hook command. */
  name: string;
  source: ComponentSource;
  /** File or directory that defines it. */
  path: string;
  plugin?: string;
  pluginVersion?: string;
  /** Hooks only: the event that triggers them. */
  event?: string;
  /** Plugin components from a plugin switched off in settings still exist on disk. */
  enabled?: boolean;
}

interface InstalledPluginsFile {
  plugins?: Record<string, { installPath?: string; version?: string; scope?: string }[]>;
}

interface HookEntry {
  type?: string;
  command?: string;
}
interface HookMatcher {
  matcher?: string;
  hooks?: HookEntry[];
}
type HookConfig = Record<string, HookMatcher[]>;

interface SettingsFile {
  hooks?: HookConfig;
  enabledPlugins?: Record<string, boolean>;
}

interface ClaudeConfigFile {
  mcpServers?: Record<string, unknown>;
  projects?: Record<string, { mcpServers?: Record<string, unknown> }>;
}

interface PluginManifest {
  hooks?: HookConfig;
}

export function findInstalled(dirs: ClaudeDirs, projectPaths: string[] = []): InstalledComponent[] {
  const found: InstalledComponent[] = [];
  const settings = dirs.settingsFiles.map((file) => readJson<SettingsFile>(file));
  const enabledPlugins: Record<string, boolean> = Object.assign(
    {},
    ...settings.map((s) => s?.enabledPlugins ?? {}),
  );

  found.push(...skillsIn(dirs.skills, 'user'));
  found.push(...agentsIn(dirs.agents, 'user'));

  for (const projectPath of projectPaths) {
    const claudeDir = projectClaudeDir(projectPath);
    found.push(...skillsIn(path.join(claudeDir, 'skills'), 'project'));
    found.push(...agentsIn(path.join(claudeDir, 'agents'), 'project'));
    const settingsFile = path.join(claudeDir, 'settings.json');
    const projectSettings = readJson<SettingsFile>(settingsFile);
    if (projectSettings?.hooks) {
      found.push(...hooksFrom(projectSettings.hooks, 'project', settingsFile));
    }
  }

  dirs.settingsFiles.forEach((file, index) => {
    const hooks = settings[index]?.hooks;
    if (hooks) found.push(...hooksFrom(hooks, 'user', file));
  });

  found.push(...pluginComponents(dirs, enabledPlugins));
  found.push(...mcpServers(dirs, projectPaths));

  return dedupe(found);
}

/**
 * `<dir>/<name>/SKILL.md` — the directory name is the skill name.
 * Presence of SKILL.md is the test, rather than `dirent.isDirectory()`: skills are
 * routinely symlinked in from elsewhere, and a symlink is not a directory entry.
 */
function skillsIn(dir: string, source: ComponentSource, plugin?: string): InstalledComponent[] {
  if (!isDirectory(dir)) return [];
  const found: InstalledComponent[] = [];
  for (const entry of readDir(dir)) {
    if (entry.isFile()) continue;
    const skillFile = path.join(dir, entry.name, 'SKILL.md');
    if (!fs.existsSync(skillFile)) continue;
    found.push({
      kind: 'skill',
      name: plugin ? `${plugin}:${entry.name}` : entry.name,
      source,
      path: skillFile,
      ...(plugin ? { plugin } : {}),
    });
  }
  return found;
}

/** `<dir>/<name>.md` — one agent per file. */
function agentsIn(dir: string, source: ComponentSource, plugin?: string): InstalledComponent[] {
  if (!isDirectory(dir)) return [];
  const found: InstalledComponent[] = [];
  for (const entry of readDir(dir)) {
    // Symlinked agent files are common too, so match on the name, not the dirent type.
    if (entry.isDirectory() || !entry.name.endsWith('.md')) continue;
    const name = entry.name.slice(0, -'.md'.length);
    found.push({
      kind: 'agent',
      name: plugin ? `${plugin}:${name}` : name,
      source,
      path: path.join(dir, entry.name),
      ...(plugin ? { plugin } : {}),
    });
  }
  return found;
}

/**
 * Plugins are read from `installed_plugins.json`, not by walking `plugins/cache`:
 * the cache also holds stale versions and mirror copies (`.agents/`, `.kiro/`, …)
 * that would multiply-count every skill.
 */
function pluginComponents(
  dirs: ClaudeDirs,
  enabledPlugins: Record<string, boolean>,
): InstalledComponent[] {
  const installed = readJson<InstalledPluginsFile>(
    path.join(dirs.plugins, 'installed_plugins.json'),
  );
  if (!installed?.plugins) return [];

  const found: InstalledComponent[] = [];
  for (const [key, entries] of Object.entries(installed.plugins)) {
    const plugin = key.split('@')[0] ?? key;
    const enabled = enabledPlugins[key] !== false;
    for (const entry of entries ?? []) {
      const root = entry.installPath;
      if (!root || !isDirectory(root)) continue;

      const components = [
        ...skillsIn(path.join(root, 'skills'), 'plugin', plugin),
        ...agentsIn(path.join(root, 'agents'), 'plugin', plugin),
        ...pluginHooks(root, plugin),
      ];
      for (const component of components) {
        found.push({
          ...component,
          enabled,
          ...(entry.version ? { pluginVersion: entry.version } : {}),
        });
      }
    }
  }
  return found;
}

function pluginHooks(root: string, plugin: string): InstalledComponent[] {
  const manifests = [
    path.join(root, '.claude-plugin', 'plugin.json'),
    path.join(root, 'hooks', 'hooks.json'),
  ];
  const found: InstalledComponent[] = [];
  for (const file of manifests) {
    const manifest = readJson<PluginManifest>(file);
    if (manifest?.hooks) found.push(...hooksFrom(manifest.hooks, 'plugin', file, plugin));
  }
  return found;
}

/**
 * A hook's identity is its command string: that is what `stop_hook_summary`
 * records in transcripts, so it is the only thing the two sides can be joined on.
 */
function hooksFrom(
  hooks: HookConfig,
  source: ComponentSource,
  file: string,
  plugin?: string,
): InstalledComponent[] {
  const found: InstalledComponent[] = [];
  for (const [event, matchers] of Object.entries(hooks)) {
    for (const matcher of matchers ?? []) {
      for (const hook of matcher?.hooks ?? []) {
        if (!hook?.command) continue;
        found.push({
          kind: 'hook',
          name: hook.command,
          source,
          path: file,
          event,
          ...(plugin ? { plugin } : {}),
        });
      }
    }
  }
  return found;
}

function mcpServers(dirs: ClaudeDirs, projectPaths: string[]): InstalledComponent[] {
  const config = readJson<ClaudeConfigFile>(dirs.configFile);
  if (!config) return [];

  const found: InstalledComponent[] = [];
  for (const name of Object.keys(config.mcpServers ?? {})) {
    found.push({ kind: 'mcp', name, source: 'user', path: dirs.configFile });
  }
  for (const projectPath of projectPaths) {
    const project = config.projects?.[projectPath];
    for (const name of Object.keys(project?.mcpServers ?? {})) {
      found.push({ kind: 'mcp', name, source: 'project', path: dirs.configFile });
    }
  }
  return found;
}

/** The same plugin can be installed at several versions; one entry per identity is enough. */
function dedupe(components: InstalledComponent[]): InstalledComponent[] {
  const seen = new Map<string, InstalledComponent>();
  for (const component of components) {
    const key = `${component.kind} ${component.name} ${component.source}`;
    const existing = seen.get(key);
    if (!existing || (existing.enabled === false && component.enabled !== false)) {
      seen.set(key, component);
    }
  }
  return [...seen.values()];
}

function readDir(dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}
