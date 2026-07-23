import { describe, expect, it } from 'vitest';

import { completionScript, SHELLS, type CompletionSpec } from '../src/completions.js';

const SPEC: CompletionSpec = {
  commands: ['report', 'doctor'],
  flags: ['--json', '--sort'],
  values: { '--sort': ['fires', 'cost'], '--theme': ['dark', 'nord'] },
};

describe('completion scripts', () => {
  it.each(SHELLS)('%s lists every command, flag and known value', (shell) => {
    const script = completionScript(shell, SPEC);
    for (const word of ['report', 'doctor', '--json', '--sort', 'fires', 'cost', 'dark', 'nord']) {
      expect(script).toContain(word);
    }
  });

  it('registers itself with the right shell hook', () => {
    expect(completionScript('bash', SPEC)).toContain('complete -F _skillscope skillscope');

    const zsh = completionScript('zsh', SPEC);
    // The #compdef line must be first, or zsh will not autoload the script.
    expect(zsh.split('\n')[0]).toBe('#compdef skillscope');
    expect(zsh).toContain('compdef _skillscope skillscope');
  });

  it('is dependency-free shell text, not a wrapper around node', () => {
    for (const shell of SHELLS) {
      const script = completionScript(shell, SPEC);
      expect(script).not.toContain('require(');
      expect(script).not.toContain('node ');
    }
  });

  it('escapes a single quote so it cannot break out of the word list', () => {
    const script = completionScript('bash', {
      commands: ["it's"],
      flags: [],
      values: {},
    });
    expect(script).toContain("it'\\''s");
    // The generated word list stays inside one pair of single quotes.
    expect(script).not.toMatch(/-W 'it's/);
  });
});
