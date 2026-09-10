import type { EngineAdapter } from '../core/engine.js';
import type { DetectionReport } from '../core/engine-detection.js';
import { detectClaudeEngine, detectCodexEngine } from '../infra/engine-detect.js';
import type { CliOptions } from './arguments.js';

interface AdapterOptions { readonly executablePath?: string; readonly model?: string }
export type AdapterFactory = (options: AdapterOptions) => EngineAdapter;
interface EngineRegistration {
  readonly pathVariable: string;
  readonly detect: (options: { executablePath?: string }) => Promise<DetectionReport>;
  readonly load: () => Promise<AdapterFactory>;
}

const ENGINES: Record<CliOptions['engine'], EngineRegistration> = {
  codex: { pathVariable: 'MINICLAW_CODEX_PATH', detect: detectCodexEngine,
    load: async () => {
      const { CodexCliAdapter } = await import('../adapters/codex-cli/index.js');
      return options => new CodexCliAdapter(options);
    } },
  claude: { pathVariable: 'MINICLAW_CLAUDE_PATH', detect: detectClaudeEngine,
    load: async () => {
      const { ClaudeCodeAdapter } = await import('../adapters/claude-code/index.js');
      return options => new ClaudeCodeAdapter(options);
    } },
};

export function selectEngine(options: CliOptions, environment: NodeJS.ProcessEnv = process.env) {
  const registration = ENGINES[options.engine];
  return { executablePath: options.executablePath ?? environment[registration.pathVariable],
    detect: registration.detect, load: registration.load };
}
