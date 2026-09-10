export interface CodexCliOptions {
  readonly executablePath?: string;
  readonly model?: string;
}

// These disable tool delivery, while environments: [] removes filesystem execution access.
const disabledFeatures = ['apps', 'browser_use', 'browser_use_external', 'browser_use_full_cdp_access',
  'computer_use', 'code_mode', 'code_mode_host', 'hooks', 'image_generation', 'in_app_browser',
  'memories', 'chronicle', 'multi_agent', 'multi_agent_v2', 'plugins', 'remote_plugin', 'shell_tool',
  'shell_snapshot', 'skill_search', 'skill_mcp_dependency_install', 'unified_exec', 'view_image',
  'request_permissions_tool', 'goals', 'sleep_tool', 'tool_suggest', 'unbounded_connection_retries'];

export const safeConfig: Readonly<Record<string, unknown>> = {
  ...Object.fromEntries(disabledFeatures.map((name) => [`features.${name}`, false])),
  'features.skip_host_skill_discovery': true,
  mcp_servers: {}, web_search: 'disabled', model_provider: 'openai',
  project_doc_max_bytes: 0, developer_instructions: '',
  approval_policy: 'never', sandbox_mode: 'read-only',
};

export function serverArgs(): string[] {
  return ['app-server', '--listen', 'stdio://', ...Object.entries(safeConfig)
    .flatMap(([key, value]) => ['-c', `${key}=${JSON.stringify(value)}`])];
}

export function codexEnvironment(source: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ['HOME', 'PATH', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'LANG', 'TERM']) {
    if (source[key] !== undefined) env[key] = source[key];
  }
  return env;
}

export function threadParams(options: { cwd: string; model?: string }): Record<string, unknown> {
  return { cwd: options.cwd, model: options.model, modelProvider: 'openai',
    approvalPolicy: 'never', approvalsReviewer: 'user', sandbox: 'read-only',
    ephemeral: true, environments: [], dynamicTools: [], selectedCapabilityRoots: [],
    config: safeConfig, developerInstructions: 'This is a text-only chat. No tools or workspace access are available.',
  };
}
