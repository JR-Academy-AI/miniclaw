// The single per-tool-call gate (HARNESS §6.5 enforcement point ②).
// Engine adapters call `check` before every tool call and must obey the result.

export interface ToolRequest {
  readonly toolUseId: string | null;
  /** Engine tool name, e.g. "Read", "Bash", "Edit". */
  readonly tool: string;
  readonly input: Readonly<Record<string, unknown>>;
}

export interface GateResult {
  readonly allowed: boolean;
  /** Shown to the agent when denied, and written to the audit trail. */
  readonly reason: string;
}

export interface ToolGate {
  check(request: ToolRequest, signal?: AbortSignal): Promise<GateResult>;
}
