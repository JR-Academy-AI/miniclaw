// Error taxonomy shared by every engine adapter (subset of GATEWAY §6 used in v0.1).
// Adapters translate raw engine errors into these kinds; the TUI only reads `kind`, `message`, `hint`.

export type ErrorKind =
  | 'AUTH'
  | 'QUOTA_EXHAUSTED'
  | 'RATE_LIMITED'
  | 'OVERLOADED'
  | 'NETWORK'
  | 'INVALID_CONFIG'
  | 'UNKNOWN';

export interface EngineError {
  readonly kind: ErrorKind;
  /** What went wrong, in plain English. */
  readonly message: string;
  /** How to fix it, e.g. an exact command to run. */
  readonly hint?: string;
  /** ISO 8601 time when the quota resets, when the engine says so. */
  readonly resetAt?: string;
}
