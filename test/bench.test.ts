/**
 * Phase 1 performance gate, measured against real local transcripts.
 * Opt-in, because it reads whatever happens to be in the developer's ~/.claude:
 *
 *   SKILLSCOPE_BENCH=1 npx vitest run test/bench.test.ts
 *
 * It prints counts and elapsed time only — never transcript content.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { attribute } from '../src/analyze/attribute.js';
import { findClaudeDirs } from '../src/discovery/claude-dirs.js';
import { findInstalled } from '../src/discovery/installed.js';
import { emptyStats, type SessionEvent } from '../src/parser/schema.js';
import { findTranscripts, parseTranscript } from '../src/parser/transcript.js';

const enabled = process.env['SKILLSCOPE_BENCH'] === '1';

describe.skipIf(!enabled)('inventory of the local install', () => {
  it('enumerates installed components', () => {
    const installed = findInstalled(findClaudeDirs());
    const counts = new Map<string, number>();
    for (const component of installed) {
      const key = `${component.kind}/${component.source}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    console.log(
      [
        `total: ${installed.length}`,
        ...[...counts].sort().map(([key, count]) => `${key}: ${count}`),
        `sample skills: ${installed
          .filter((c) => c.kind === 'skill')
          .slice(0, 5)
          .map((c) => c.name)
          .join(', ')}`,
        `sample agents: ${installed
          .filter((c) => c.kind === 'agent')
          .slice(0, 5)
          .map((c) => c.name)
          .join(', ')}`,
      ].join('\n'),
    );
    expect(installed.length).toBeGreaterThan(0);
  });
});

describe.skipIf(!enabled)('benchmark: parse the local ~/.claude', () => {
  it('parses every session', { timeout: 600_000 }, async () => {
    const root = path.join(os.homedir(), '.claude', 'projects');
    const files = findTranscripts(root);
    const stats = emptyStats();
    const counts = new Map<string, number>();
    const events: SessionEvent[] = [];

    const started = Date.now();
    let bytes = 0;
    for (const file of files) {
      bytes += fs.statSync(file.path).size;
      for await (const event of parseTranscript(file, { stats })) {
        counts.set(event.kind, (counts.get(event.kind) ?? 0) + 1);
        events.push(event);
      }
    }
    const elapsedMs = Date.now() - started;

    const report = attribute(events, findInstalled(findClaudeDirs()));
    const top = (kind: string): string =>
      report.used
        .filter((u) => u.kind === kind)
        .slice(0, 5)
        .map((u) => `${u.name} (${u.fires}x, ${u.tokens.total.toLocaleString()} tok)`)
        .join('\n                 ');
    const deadByKind = new Map<string, number>();
    for (const component of report.dead) {
      deadByKind.set(component.kind, (deadByKind.get(component.kind) ?? 0) + 1);
    }
    console.log(
      [
        '',
        `top skills:      ${top('skill') || 'none'}`,
        `top agents:      ${top('agent') || 'none'}`,
        `dead weight:     ${report.dead.length} of ${report.used.length + report.dead.length} installed ` +
          `(${[...deadByKind].map(([k, v]) => `${k}=${v}`).join(' ')})`,
        `fired, not installed: ${report.untracked.length}`,
        `measured tokens: ${report.cost.totals.total.toLocaleString()} ` +
          `(unattributed ${report.cost.unattributed.total.toLocaleString()}, ` +
          `unlinked subagent ${report.cost.unlinkedSubagent.total.toLocaleString()})`,
      ].join('\n'),
    );

    const perHundred = files.length ? (elapsedMs / files.length) * 100 : 0;
    console.log(
      [
        `sessions:      ${files.length}`,
        `bytes:         ${(bytes / 1e6).toFixed(0)} MB`,
        `lines:         ${stats.lines}`,
        `malformed:     ${stats.malformed}`,
        `unknown types: ${[...stats.unknownTypes.keys()].join(', ') || 'none'}`,
        `events:        ${[...counts].map(([k, v]) => `${k}=${v}`).join(' ')}`,
        `elapsed:       ${elapsedMs} ms  (${perHundred.toFixed(0)} ms per 100 sessions)`,
      ].join('\n'),
    );

    // The gate in the plan: under 5s for ~100 sessions.
    expect(perHundred).toBeLessThan(5000);
  });
});
