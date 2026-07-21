#!/usr/bin/env node
/**
 * Entry point.
 *
 * Argument parsing is `node:util.parseArgs` rather than commander: four commands
 * and eight flags do not need a dependency, and a tool that promises "nothing
 * leaves your machine" is easier to believe with an empty `dependencies` block.
 */
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';

import { componentView, cost, report, type Format, type Sort } from './commands.js';
import { loadReport } from './load.js';

const COMMANDS = ['report', 'skills', 'agents', 'cost'] as const;
type Command = (typeof COMMANDS)[number];

const SORTS: Sort[] = ['fires', 'cost', 'last-used'];

const HELP = `skillscope — which Claude Code skills, subagents and hooks actually fire

Usage
  skillscope [command] [options]

Commands
  report            summary of everything (default)
  skills            per-skill detail
  agents            per-subagent detail
  cost              measured tokens by component

Options
  --json            machine-readable output
  --md              markdown, for pasting into an issue
  --since <date>    ignore activity before this date (YYYY-MM-DD)
  --project <text>  only sessions whose project path contains this text
  --sort <key>      fires | cost | last-used   (default: fires)
  --dead            list what has never fired
  --untracked       list what fired but is not installed
  -h, --help        show this
  -v, --version     show version

Everything is read locally from ~/.claude. Nothing is uploaded, and nothing on
disk is modified. Override the location with CLAUDE_CONFIG_DIR.
`;

export async function run(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        json: { type: 'boolean', default: false },
        md: { type: 'boolean', default: false },
        since: { type: 'string' },
        project: { type: 'string' },
        sort: { type: 'string', default: 'fires' },
        dead: { type: 'boolean', default: false },
        untracked: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
        version: { type: 'boolean', short: 'v', default: false },
      },
    });
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
    format: (values.json ? 'json' : values.md ? 'md' : 'terminal') as Format,
    sort,
    dead: values.dead === true,
    untracked: values.untracked === true,
  };

  const loaded = await loadReport({
    ...(values.since ? { since: values.since } : {}),
    ...(values.project ? { project: values.project } : {}),
  });

  const output =
    command === 'skills'
      ? componentView(loaded, 'skill', view)
      : command === 'agents'
        ? componentView(loaded, 'agent', view)
        : command === 'cost'
          ? cost(loaded, view)
          : report(loaded, view);

  process.stdout.write(`${output}\n`);
  return 0;
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
