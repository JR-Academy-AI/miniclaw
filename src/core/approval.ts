// Asking the human. The TUI implements ApprovalBroker; the tool gate calls it when policy says "ask".

export type ApprovalChoice = 'once' | 'session' | 'deny';

export interface ApprovalRequest {
  readonly toolUseId: string | null;
  readonly tool: string;
  /** One-line human summary of the action, e.g. "run: npm test" or "write: src/app.ts". */
  readonly summary: string;
  /** Why policy wants a human decision. */
  readonly reason: string;
}

export interface ApprovalBroker {
  /** Resolves with the user's choice. Must resolve "deny" if the signal aborts. */
  request(request: ApprovalRequest, signal?: AbortSignal): Promise<ApprovalChoice>;
}
