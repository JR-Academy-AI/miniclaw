export interface CliOptions {
  readonly engine: 'codex' | 'claude';
  readonly demo: boolean;
  readonly doctor: boolean;
  readonly help: boolean;
  readonly directory?: string;
  readonly executablePath?: string;
  readonly model?: string;
}

const VALUE_FLAGS = new Map<string, 'executablePath' | 'model' | 'engine'>([
  ['--claude-path', 'executablePath'], ['--codex-path', 'executablePath'], ['--model', 'model'], ['--engine', 'engine'],
]);

export function parseArguments(args: readonly string[]): CliOptions {
  const options: { engine: 'codex' | 'claude'; demo: boolean; doctor: boolean; help: boolean;
    directory?: string; executablePath?: string; model?: string } = {
    engine: 'codex', demo: false, doctor: false, help: false,
  };
  const pathEngines = new Set<string>();
  let positional = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (!positional && arg === '--') { positional = true; continue; }
    const field = positional ? undefined : VALUE_FLAGS.get(arg);
    if (field) {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value.`);
      if (field === 'engine') {
        if (value !== 'codex' && value !== 'claude') throw new Error('--engine must be codex or claude.');
        options.engine = value;
      } else options[field] = value;
      if (field === 'executablePath') pathEngines.add(arg === '--codex-path' ? 'codex' : 'claude');
    } else if (!positional && arg === '--demo') options.demo = true;
    else if (!positional && arg === '--doctor') options.doctor = true;
    else if (!positional && (arg === '--help' || arg === '-h')) options.help = true;
    else if (!positional && arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    else if (options.directory) throw new Error('Provide only one workspace directory.');
    else options.directory = arg;
  }
  if ([...pathEngines].some(engine => engine !== options.engine)) {
    throw new Error(`Executable path flag does not match --engine ${options.engine}. Choose the matching engine explicitly.`);
  }
  return options;
}

export const CLI_HELP = `miniclaw — local agent chat

Usage: miniclaw [options] [directory]

  --engine <name>        codex (default) or claude
  --demo                 Interactive simulated engine; no provider requests
  --doctor               Print real engine location, version and login checks
  --codex-path <path>     Use this Codex executable
  --claude-path <path>    Use this Claude executable
  --model <name>          Model for the selected engine (otherwise its default)
  -h, --help             Show this help

Chat: /help, /clear (view only), /exit. Esc interrupts; Ctrl+C exits.
Codex v0.1 is chat-only. Claude tools pass through the miniclaw permission gate.
Default workspace: a new temporary session directory under ~/.miniclaw.
Environment: MINICLAW_HOME changes the app data root.
MINICLAW_CODEX_PATH and MINICLAW_CLAUDE_PATH pin their respective engine executables.
`;
