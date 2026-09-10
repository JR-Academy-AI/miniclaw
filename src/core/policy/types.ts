// v0.1 minimal policy types. The interface is the final one (HARNESS §6.3 `decide`);
// v0.2 swaps the rule set for the full capability engine without changing callers.
import type { ToolRequest } from '../tool-gate.js';

export type Verdict = 'allow' | 'deny' | 'ask';

export interface Decision {
  readonly verdict: Verdict;
  readonly reason: string;
  /** Stable id of the rule that produced the verdict, e.g. "hard-floor.ssh". */
  readonly ruleId: string;
}

export interface PolicyContext {
  /** The user's home directory. */
  readonly homeDir: string;
  /** Root of miniclaw's own data, normally ~/.miniclaw. */
  readonly miniclawHome: string;
  /** This session's working directory; the only place under miniclawHome agents may touch. */
  readonly workspaceDir: string;
}

export type DecideFn = (request: ToolRequest, context: PolicyContext) => Decision;
