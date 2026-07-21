# Contributing

Thanks for looking. SkillScope is small on purpose, and easy to add to.

## Getting set up

```bash
npm install
npm test          # vitest
npm run typecheck # tsc --noEmit
npm run build     # tsc -> dist/
node dist/cli.js  # run it against your own ~/.claude
```

Node 18+. There are no runtime dependencies and we would like to keep it that
way — a new one needs a line in the PR explaining what it does that a few lines
of code cannot.

## The shape of the thing

```
src/parser/     transcript .jsonl -> normalized SessionEvent stream
src/discovery/  what is installed on disk
src/analyze/    join the two; attribute tokens
src/render/     terminal / json / markdown
src/commands.ts which rows each command shows
src/cli.ts      argument parsing (node:util.parseArgs)
```

Rules that matter more than style:

1. **Read-only.** Nothing under `~/.claude` is ever written.
2. **Nothing leaves the machine.** No network calls, no telemetry, ever.
3. **Never crash on a transcript.** Unknown entry types are counted and passed
   through; malformed lines are counted and skipped. A half-written session is
   normal, not exceptional.
4. **Measured and estimated stay apart.** If a number is inferred, it says so
   wherever it is displayed.

## Fixtures are the contract

`test/fixtures/*.jsonl` are real transcripts with every piece of prose removed.
They are how we know a parser change did not break anything.

Regenerate or add one with:

```bash
node scripts/make-fixture.mjs ~/.claude/projects/<project>/<session>.jsonl \
  test/fixtures/session-something.jsonl 200
```

The sanitizer rebuilds each entry from a whitelist, so anything it does not
explicitly keep cannot leak. It keeps structure, tool names, skill and subagent
names, timestamps and token counts; it replaces all user, assistant, thinking and
tool-result text with `[redacted]`, rewrites `cwd` to `/home/example/project-a`,
scrubs home paths out of hook commands, and renumbers uuids in a per-file
namespace.

**Check the diff before committing a fixture.** If your transcripts contain
secrets inside tool names or hook command strings, those are kept by design.

When you assert a new number in a test, count it independently first (grep, or a
throwaway script) rather than copying whatever the code currently prints.

## Adding support for a new transcript format

Claude Code writes a `version` on most entries. Today everything from 2.1.x is
handled by `src/parser/adapters/v1.ts`.

For a format that no longer fits:

1. Add `src/parser/adapters/v2.ts` exporting the same `mapEntry` shape.
2. Add a branch in `pickAdapter()` in `src/parser/transcript.ts`.
3. Add a fixture from a real session in the new format.

Nothing else should need to move. If it does, that is a bug in the seam — say so
in the issue.

## Good first issues

Look for the `good first issue` label. Most of them are one of:

- a new stat in the report (each is a small function plus a test)
- a `--sort` key
- a renderer tweak, or a new output format
- a theme for the Phase 4 stats card
- documentation of a transcript field we do not use yet

## Pull requests

- Conventional commit subject (`feat:`, `fix:`, `docs:`…).
- `npm test` and `npm run typecheck` green.
- New behaviour comes with a test; new numbers come with the count you checked
  them against.
