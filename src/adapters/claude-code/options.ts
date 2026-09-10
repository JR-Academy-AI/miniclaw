import type { Options } from '@anthropic-ai/claude-agent-sdk';
import type { SessionOptions } from '../../core/engine.js';
import { asRecord } from './read.js';

export interface ClaudeAdapterOptions {
  readonly executablePath?: string;
  readonly model?: string;
}

const TOOL_NAMES = ['Read', 'Glob', 'Grep', 'Bash', 'Write', 'Edit', 'NotebookEdit', 'WebFetch', 'WebSearch'];

export function isolatedEnvironment(source: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ['HOME', 'PATH', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'LANG', 'TERM']) {
    const value = source[key];
    if (value !== undefined) env[key] = value;
  }
  return { ...env, CLAUDE_CODE_MAX_RETRIES: '2', API_TIMEOUT_MS: '120000',
    CLAUDE_CODE_RETRY_WATCHDOG: '0', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
    CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: '1' };
}

interface HookContext {
  readonly session: SessionOptions;
  readonly signal: () => AbortSignal;
}

function gateHook(context: HookContext): NonNullable<Options['hooks']> {
  return { PreToolUse: [{ matcher: '.*', timeout: 3600, hooks: [async (input, toolUseId, { signal }) => {
    if (input.hook_event_name !== 'PreToolUse') return {};
    const combined = AbortSignal.any([signal, context.signal()]);
    let allowed = false;
    let reason = 'The permission gate failed or was cancelled; tool denied.';
    try {
      const result = await context.session.toolGate.check({ toolUseId: toolUseId ?? null,
        tool: input.tool_name, input: asRecord(input.tool_input) ?? {} }, combined);
      allowed = result.allowed && !combined.aborted;
      reason = result.reason;
    } catch {
      // A failed security boundary never falls through to engine permissions.
    }
    return { hookSpecificOutput: { hookEventName: 'PreToolUse',
      permissionDecision: allowed ? 'allow' : 'deny', permissionDecisionReason: reason } };
  }] }] };
}

export function sdkOptions(config: ClaudeAdapterOptions, context: HookContext): Options {
  return { cwd: context.session.cwd, model: context.session.model ?? config.model,
    pathToClaudeCodeExecutable: config.executablePath,
    env: isolatedEnvironment(process.env), settingSources: [], strictMcpConfig: true,
    mcpServers: {}, skills: [], settings: { disableBundledSkills: true }, tools: [...TOOL_NAMES],
    permissionMode: 'default', includePartialMessages: true, persistSession: false,
    hooks: gateHook(context),
    canUseTool: async () => ({ behavior: 'deny', message: 'Tool did not receive approval through miniclaw.' }),
  };
}
