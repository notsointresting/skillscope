/**
 * `skillscope completions <shell>` — emits a bash or zsh completion script.
 *
 * The script is generated from the same command/flag/value lists the CLI parses,
 * rather than a hand-maintained copy, so adding a command or a theme cannot leave
 * completions silently stale. Dependency-free, matching the project's stance:
 * the output is plain shell text, and nothing is written to disk.
 */

export const SHELLS = ['bash', 'zsh'] as const;
export type Shell = (typeof SHELLS)[number];

export interface CompletionSpec {
  /** Subcommands, e.g. report / skills / doctor. */
  commands: readonly string[];
  /** Long flags, with the leading `--`. */
  flags: readonly string[];
  /** Flags that take a value from a known set, e.g. `--sort` -> fires, cost. */
  values: Readonly<Record<string, readonly string[]>>;
}

/** Single-quoted for shell embedding: the only unsafe character is `'` itself. */
const shellSafe = (value: string): string => value.replaceAll("'", "'\\''");

const words = (list: readonly string[]): string => list.map(shellSafe).join(' ');

function bashScript(spec: CompletionSpec): string {
  // A case arm per value-taking flag, so `--sort <TAB>` offers the keys.
  const valueArms = Object.entries(spec.values)
    .map(
      ([flag, options]) =>
        `    ${shellSafe(flag)})\n` +
        `      COMPREPLY=( $(compgen -W '${words(options)}' -- "$cur") )\n` +
        `      return 0\n` +
        `      ;;`,
    )
    .join('\n');

  return `# skillscope bash completion
_skillscope() {
  local cur prev
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"

  # A value for the flag just typed.
  case "$prev" in
${valueArms}
  esac

  if [[ "$cur" == -* ]]; then
    COMPREPLY=( $(compgen -W '${words(spec.flags)}' -- "$cur") )
    return 0
  fi

  # The subcommand is the first non-flag word after the binary.
  local i seen=0
  for (( i = 1; i < COMP_CWORD; i++ )); do
    [[ "\${COMP_WORDS[i]}" == -* ]] && continue
    seen=1
    break
  done

  if (( seen == 0 )); then
    COMPREPLY=( $(compgen -W '${words(spec.commands)}' -- "$cur") )
  else
    COMPREPLY=( $(compgen -W '${words(spec.flags)}' -- "$cur") )
  fi
  return 0
}
complete -F _skillscope skillscope
`;
}

function zshScript(spec: CompletionSpec): string {
  const valueArms = Object.entries(spec.values)
    .map(
      ([flag, options]) =>
        `    ${shellSafe(flag)})\n` +
        `      compadd -- ${words(options)}\n` +
        `      return 0\n` +
        `      ;;`,
    )
    .join('\n');

  return `#compdef skillscope
# skillscope zsh completion
_skillscope() {
  local cur prev
  cur=\${words[CURRENT]}
  prev=\${words[CURRENT-1]}

  case "$prev" in
${valueArms}
  esac

  if [[ "$cur" == -* ]]; then
    compadd -- ${words(spec.flags)}
    return 0
  fi

  # The subcommand is the first non-flag word after the binary.
  local i seen=0
  for (( i = 2; i < CURRENT; i++ )); do
    [[ \${words[i]} == -* ]] && continue
    seen=1
    break
  done

  if (( seen == 0 )); then
    compadd -- ${words(spec.commands)}
  else
    compadd -- ${words(spec.flags)}
  fi
  return 0
}
compdef _skillscope skillscope
`;
}

/** The completion script for `shell`, built from the live CLI spec. */
export function completionScript(shell: Shell, spec: CompletionSpec): string {
  return shell === 'bash' ? bashScript(spec) : zshScript(spec);
}
