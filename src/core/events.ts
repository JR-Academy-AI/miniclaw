// The unified internal event stream. Engine adapters emit these; the TUI renders them;
// the transcript writes them as JSONL. Nothing outside an adapter may see engine-specific messages.
import type { EngineError } from './errors.js';
import type { Verdict } from './policy/types.js';

export interface Usage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
}

export type ChatEvent =
  | { readonly type: 'usage.updated'; readonly usage: Usage | null; readonly costUsd: number | null; readonly completeness: 'partial' | 'complete' | 'unavailable' }
  | { readonly type: 'user.message'; readonly text: string }
  | { readonly type: 'session.ready'; readonly sessionId: string; readonly model: string | null; readonly cwd: string }
  | { readonly type: 'text.delta'; readonly messageId: string; readonly text: string }
  | { readonly type: 'thinking.delta'; readonly messageId: string; readonly text: string }
  | { readonly type: 'tool.started'; readonly toolUseId: string; readonly tool: string; readonly summary: string }
  | { readonly type: 'tool.finished'; readonly toolUseId: string; readonly ok: boolean; readonly summary: string }
  | {
      readonly type: 'policy.decided';
      readonly toolUseId: string | null;
      readonly tool: string;
      readonly verdict: Exclude<Verdict, 'ask'>;
      readonly reason: string;
      readonly ruleId: string;
      /** "rule" when policy decided alone, "user" when a human answered an approval card. */
      readonly resolvedBy: 'rule' | 'user';
    }
  | { readonly type: 'turn.completed'; readonly usage: Usage | null; readonly costUsd: number | null; readonly durationMs: number }
  | { readonly type: 'turn.interrupted' }
  | { readonly type: 'error'; readonly error: EngineError };

export type ChatEventType = ChatEvent['type'];

/** Anything that consumes events: the transcript, the audit trail, tests. */
export interface EventSink {
  write(event: ChatEvent): void;
}
