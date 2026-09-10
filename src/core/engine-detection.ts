// Result of probing an engine before chatting (GATEWAY §14, ONBOARDING §6 S2).
// Produced by src/infra/engine-detect, rendered by the TUI welcome card.

export type DetectionLevel = 'L1-locate' | 'L2-executable' | 'L3-logged-in' | 'L4-end-to-end';

export interface DetectionStep {
  readonly level: DetectionLevel;
  readonly ok: boolean;
  /** Short result, e.g. "claude 2.1.267 at ~/.local/bin/claude". */
  readonly detail: string;
  /** Every place or method tried, so a failure is explainable. */
  readonly tried: readonly string[];
}

export interface DetectionReport {
  readonly engineId: string;
  /** True when every required level passed (L4 is optional). */
  readonly ready: boolean;
  readonly steps: readonly DetectionStep[];
  readonly executablePath: string | null;
  readonly version: string | null;
  /** Exact, copy-pasteable fix when not ready. */
  readonly fix: string | null;
}
