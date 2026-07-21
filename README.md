# SkillScope

**You have 583 skills, subagents and hooks installed. 28 have ever fired.**

SkillScope reads your local Claude Code session transcripts and tells you which
skills, subagents and hooks actually run, what they cost in tokens, and which are
dead weight.

It runs entirely on your machine. Nothing is uploaded. Nothing in `~/.claude` is
modified.

```
$ npx cc-skillscope

SkillScope
172 sessions · 27 projects · 114,965 transcript lines

Fired at least once: 28 of 583 installed
Never fired: 555  (skillscope skills --dead)

Top skills
  component                                   fires  sessions     tokens  last used
  caveman:caveman                                46        44  5,120,956  2026-07-21
  andrej-karpathy-skills:karpathy-guidelines     36        35  1,240,452  2026-07-21
  ponytail:ponytail                              28        27    924,484  2026-07-21
  superpowers:executing-plans                     4         4  1,631,399  2026-07-21
  frontend-design:frontend-design                 4         4  1,087,095  2026-07-16

Tokens
  measured total     171,234,864
  unattributed       124,622,130 (no skill was active)
```

> A recorded demo GIF goes here before the v0.1.0 announcement.

## Install

```bash
npx cc-skillscope          # no install
npm i -g cc-skillscope     # or keep it around
```

Requires Node 18 or newer. The CLI is named `skillscope`; the npm package is
`cc-skillscope` because `skillscope` was taken.

## Commands

```bash
skillscope                 # summary (default)
skillscope skills          # every skill that fired
skillscope skills --dead   # every skill that never fired
skillscope agents          # subagents
skillscope cost            # measured tokens per component
skillscope wrapped         # shareable SVG stats card (--month 2026-07, --theme light)
skillscope doctor          # sanity-check installed skills, agents and plugins
```

Every command accepts:

| Flag | Meaning |
|---|---|
| `--json` | machine-readable output |
| `--md` | markdown, for pasting into an issue |
| `--since <YYYY-MM-DD>` | ignore older activity |
| `--project <text>` | only sessions whose project path contains this text |
| `--sort fires\|cost\|last-used` | ordering (default: `fires`) |
| `--dead` | what never fired |
| `--untracked` | what fired but is not installed |
| `--no-cache` | reparse everything instead of using `~/.cache/skillscope` |

`wrapped` also takes `--month <YYYY-MM>`, `--all-time` (default), `--theme dark|light`
and `--out <file>`. `doctor` is read-only: it prints findings and the exact fix,
and never modifies anything under `~/.claude`.

Set `CLAUDE_CONFIG_DIR` to analyze a Claude Code directory somewhere other than
`~/.claude`.

## Privacy

- Nothing leaves your machine. There is no telemetry, no network code, and no
  API calls anywhere in this package.
- Transcripts are read, never written. The only thing SkillScope opens for
  writing is stdout.
- `dependencies` is empty. Argument parsing is `node:util.parseArgs`; colour is a
  dozen ANSI escapes. Nothing else runs when you `npx` this.

## How the numbers are worked out

**Fires are counted, not guessed.** A skill counts as fired when it is invoked by
the `Skill` tool or by a `/slash-command`. A subagent counts when the `Agent` tool
launches it. A hook counts once per entry in a `stop_hook_summary` record.

**Direct tokens are measured.** Claude Code stamps assistant turns with the skill
that was active (`attributionSkill`), so per-skill tokens are read out of the
transcript rather than inferred. Subagents write their own transcripts under
`<session>/subagents/agent-<id>.jsonl`; those tokens are charged to the `Agent`
call that launched them, matched through the tool-use id. Turns with no skill
active are reported as **unattributed** rather than spread across components —
that number is large, and pretending otherwise would make every per-skill figure
look bigger than it is.

**Overhead is estimated, and labelled as such.** Every installed skill and
subagent puts its description into the system prompt of every session. No
transcript records that, so it is sized as `description length / 4 × sessions`.
Treat it as an order of magnitude, not a measurement.

**"Dead weight" is about components, not about you.** Installing something you
have not needed yet is not a mistake; it is just information worth having.

**Fired but not installed** is a third category: builtin agents like `Explore`,
or skills from a plugin you have since removed. They are listed separately and
never counted as dead.

## What it reads

| Thing | Where |
|---|---|
| Sessions | `~/.claude/projects/<project>/<session>.jsonl` |
| Subagent sessions | `~/.claude/projects/<project>/<session>/subagents/agent-<id>.jsonl` |
| Your skills | `~/.claude/skills/<name>/SKILL.md` (symlinks followed) |
| Your subagents | `~/.claude/agents/<name>.md` |
| Plugin components | install paths listed in `~/.claude/plugins/installed_plugins.json` |
| Hooks | `settings.json`, project `.claude/settings.json`, plugin manifests |
| MCP servers | `~/.claude.json` |

Transcript formats change. Parsing lives behind `src/parser/adapters/`, so a new
format is a new adapter file rather than a rewrite — see CONTRIBUTING.md.

## Roadmap

- **v0.1** — report, skills, agents, cost. *(this release)*
- **v0.2** — `skillscope wrapped`: a shareable stats card, with themes.
- **v0.3** — `skillscope doctor`: malformed frontmatter, shadowed names,
  orphaned plugin components, plus caching for large histories.

## Contributing

Good first issues are labelled. Fixtures live in `test/fixtures/` and are the
parser's contract: sanitized real transcripts with every piece of prose replaced.
See CONTRIBUTING.md.

## License

MIT
