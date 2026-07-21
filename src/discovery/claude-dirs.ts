/**
 * Where Claude Code keeps things, on any OS.
 * Everything is derived from `os.homedir()` + `path.join`; no `~`, no `/`.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface ClaudeDirs {
  /** `~/.claude`, or `$CLAUDE_CONFIG_DIR` when set. */
  root: string;
  projects: string;
  skills: string;
  agents: string;
  plugins: string;
  /** `<root>/settings.json` and `<root>/settings.local.json`, whether or not they exist. */
  settingsFiles: string[];
  /** `~/.claude.json` — holds global and per-project MCP servers. */
  configFile: string;
  /** False when there is nothing to analyze; the CLI explains rather than erroring. */
  exists: boolean;
}

export function findClaudeDirs(homedir: string = os.homedir()): ClaudeDirs {
  const configured = process.env['CLAUDE_CONFIG_DIR'];
  const overridden = Boolean(configured && configured.trim());
  const root = overridden ? (configured as string) : path.join(homedir, '.claude');
  // `.claude` and `.claude.json` are siblings, so an overridden config dir moves both.
  const configFile = overridden
    ? path.join(path.dirname(root), '.claude.json')
    : path.join(homedir, '.claude.json');

  return {
    root,
    projects: path.join(root, 'projects'),
    skills: path.join(root, 'skills'),
    agents: path.join(root, 'agents'),
    plugins: path.join(root, 'plugins'),
    settingsFiles: [path.join(root, 'settings.json'), path.join(root, 'settings.local.json')],
    configFile,
    exists: isDirectory(root),
  };
}

/** The `.claude` directory of a working project, which can add its own components. */
export function projectClaudeDir(projectPath: string): string {
  return path.join(projectPath, '.claude');
}

export function isDirectory(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

export function readJson<T>(file: string): T | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return undefined;
  }
}
