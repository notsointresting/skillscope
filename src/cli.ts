#!/usr/bin/env node
/**
 * Entry point.
 *
 * Argument parsing is `node:util.parseArgs` rather than commander: four commands
 * and eight flags do not need a dependency, and a tool that promises "nothing
 * leaves your machine" is easier to believe with an empty `dependencies` block.
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';

import { componentView, cost, report, wrapped, type Format, type Sort } from './commands.js';
import { completionScript, SHELLS, type Shell } from './completions.js';
import { diagnose, renderDoctor } from './doctor.js';
import { findClaudeDirs } from './discovery/claude-dirs.js';
import { findInstalled } from './discovery/installed.js';
import { loadReport } from './load.js';
import { themes } from './render/card/themes/index.js';

const COMMANDS = [
  'report',
  'skills',
  'agents',
  'hooks',
  'cost',
  'wrapped',
  'doctor',
  'completions',
] as const;
type Command = (typeof COMMANDS)[number];

const SORTS: Sort[] = ['fires', 'cost', 'last-used', 'name', 'sessions'];

/**
 * The parseArgs spec, named so `completions` can derive the flag list from the
 * same source the parser uses — a new flag cannot go missing from completions.
 */
const OPTIONS = {
  json: { type: 'boolean', default: false },
  md: { type: 'boolean', default: false },
  csv: { type: 'boolean', default: false },
  since: { type: 'string' },
  project: { type: 'string' },
  sort: { type: 'string', default: 'fires' },
  dead: { type: 'boolean', default: false },
  untracked: { type: 'boolean', default: false },
  month: { type: 'string' },
  'all-time': { type: 'boolean', default: false },
  theme: { type: 'string', default: 'dark' },
  out: { type: 'string' },
  open: { type: 'boolean', default: false },
  'no-cache': { type: 'boolean', default: false },
  help: { type: 'boolean', short: 'h', default: false },
  version: { type: 'boolean', short: 'v', default: false },
} as const;

const HELP = `skillscope — which Claude Code skills, subagents and hooks actually fire

Usage
  skillscope [command] [options]

Commands
  report            summary of everything (default)
  skills            per-skill detail
  agents            per-subagent detail
  hooks             per-hook detail
  cost              measured tokens by component
  wrapped           shareable SVG stats card
  doctor            sanity-check installed skills, agents, hooks and plugins
  completions       print a shell completion script (bash | zsh)

Options
  --json            machine-readable output
  --md              markdown, for pasting into an issue
  --csv             component table as comma-separated values
  --since <date>    ignore activity before this date (YYYY-MM-DD)
  --project <text>  only sessions whose project path contains this text
  --sort <key>      fires | cost | last-used | name | sessions   (default: fires)
  --dead            list what has never fired
  --untracked       list what fired but is not installed
  --month <YYYY-MM> wrapped: limit the card to one month
  --all-time        wrapped: whole history (default)
  --theme <name>    wrapped: card color theme (default: dark)
  --out <file>      wrapped: where to write the SVG (default: skillscope-wrapped.svg)
  --open            wrapped: open the written SVG in the default app
  --no-cache        reparse every transcript instead of using ~/.cache/skillscope
  -h, --help        show this
  -v, --version     show version

Everything is read locally from ~/.claude. Nothing is uploaded, and nothing on
disk is modified. Override the location with CLAUDE_CONFIG_DIR.
`;

export async function run(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, allowPositionals: true, options: OPTIONS });
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n\n${HELP}`);
    return 2;
  }

  const { values, positionals } = parsed;
  if (values.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (values.version) {
    process.stdout.write(`${version()}\n`);
    return 0;
  }

  const command = (positionals[0] ?? 'report') as Command;
  if (!COMMANDS.includes(command)) {
    process.stderr.write(`Unknown command: ${command}\n\n${HELP}`);
    return 2;
  }

  const sort = values.sort as Sort;
  if (!SORTS.includes(sort)) {
    process.stderr.write(`Unknown --sort: ${values.sort} (expected ${SORTS.join(', ')})\n`);
    return 2;
  }

  const view = {
    format: (values.json ? 'json' : values.md ? 'md' : values.csv ? 'csv' : 'terminal') as Format,
    sort,
    dead: values.dead === true,
    untracked: values.untracked === true,
  };

  if (command === 'completions') {
    const shell = positionals[1];
    if (shell === undefined || !SHELLS.includes(shell as Shell)) {
      process.stderr.write(
        `completions expects a shell (${SHELLS.join(' | ')})` +
          `${shell === undefined ? '' : `, got: ${shell}`}\n`,
      );
      return 2;
    }
    process.stdout.write(
      completionScript(shell as Shell, {
        commands: COMMANDS,
        // Derived from the parser's own spec, so a new flag is never missed.
        flags: Object.keys(OPTIONS).map((name) => `--${name}`),
        values: { '--sort': SORTS, '--theme': Object.keys(themes) },
      }),
    );
    return 0;
  }

  if (command === 'doctor') {
    // Doctor inspects what is installed; it does not need the transcript history.
    const dirs = findClaudeDirs();
    const findings = diagnose(dirs, findInstalled(dirs));
    process.stdout.write(`${renderDoctor(findings)}\n`);
    return 0;
  }

  let month: { since: string; until: string; label: string } | undefined;
  if (command === 'wrapped' && values.month) {
    month = monthRange(values.month);
    if (!month) {
      process.stderr.write(`--month expects YYYY-MM, got: ${values.month}\n`);
      return 2;
    }
  }

  const loaded = await loadReport({
    ...(month ? { since: month.since, until: month.until } : {}),
    ...(!month && values.since ? { since: values.since } : {}),
    ...(values.project ? { project: values.project } : {}),
    cache: values['no-cache'] !== true,
  });

  if (command === 'wrapped') {
    let svg: string;
    try {
      svg = wrapped(loaded, month ? month.label : 'All time', values.theme as string);
    } catch (error) {
      process.stderr.write(`${(error as Error).message}\n`);
      return 2;
    }
    const out = values.out ?? 'skillscope-wrapped.svg';
    writeFileSync(out, svg);
    process.stdout.write(`Wrote ${out} — open it in a browser, share it anywhere.\n`);
    if (values.open) openInDefaultApp(out);
    return 0;
  }

  const output =
    command === 'skills'
      ? componentView(loaded, 'skill', view)
      : command === 'agents'
        ? componentView(loaded, 'agent', view)
        : command === 'hooks'
          ? componentView(loaded, 'hook', view)
          : command === 'cost'
            ? cost(loaded, view)
            : report(loaded, view);

  process.stdout.write(`${output}\n`);
  return 0;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

/** "2026-07" -> filter bounds plus a human label. Undefined when malformed. */
function monthRange(month: string): { since: string; until: string; label: string } | undefined {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return undefined;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (monthIndex < 0 || monthIndex > 11) return undefined;
  const next = monthIndex === 11 ? `${year + 1}-01` : `${year}-${String(monthIndex + 2).padStart(2, '0')}`;
  return { since: month, until: next, label: `${MONTHS[monthIndex]} ${year}` };
}

/**
 * Open a file with the platform default app. Best-effort: a launch failure is
 * printed and swallowed, never fatal — the card is already written to disk.
 */
function openInDefaultApp(file: string): void {
  const command =
    process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  try {
    // `start` is a cmd.exe builtin, not an executable, so it needs a shell.
    const child = spawn(command, [file], {
      detached: true,
      stdio: 'ignore',
      shell: process.platform === 'win32',
    });
    child.on('error', () => process.stderr.write(`Could not open ${file} automatically.\n`));
    child.unref();
  } catch {
    process.stderr.write(`Could not open ${file} automatically.\n`);
  }
}

function version(): string {
  try {
    const require = createRequire(import.meta.url);
    return (require('../package.json') as { version: string }).version;
  } catch {
    return 'unknown';
  }
}

// True when run as the bin, false when imported by a test.
if (import.meta.url.endsWith('cli.js')) {
  run(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(`skillscope failed: ${(error as Error).message}\n`);
      process.exitCode = 1;
    });
}
