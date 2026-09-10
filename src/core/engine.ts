// Engine adapter contract (PRD F2). Core and TUI depend only on this; SDKs live in src/adapters/<engine>/.
import type { ChatEvent } from './events.js';
import type { ToolGate } from './tool-gate.js';

export interface EngineCapabilities {
  /** Can stop a turn in progress and keep the session usable afterwards. */
  readonly interrupt: boolean;
  /** Emits text.delta while the model is still writing. */
  readonly streaming: boolean;
  /** turn.completed carries costUsd. */
  readonly reportsCost: boolean;
}

export interface SessionOptions {
  /** Working directory for the engine (the session workspace). */
  readonly cwd: string;
  /** Model override; undefined means the engine default. */
  readonly model?: string;
  /** Every tool call must pass this gate before it runs. */
  readonly toolGate: ToolGate;
}

export interface EngineSession {
  /**
   * Runs one user turn and yields events until exactly one terminal event:
   * turn.completed, turn.interrupted, or error. Context carries over to the next send().
   */
  send(prompt: string): AsyncIterable<ChatEvent>;
  /** Stops the current turn; the in-flight send() ends with turn.interrupted. No-op when idle. */
  interrupt(): Promise<void>;
  /** Releases the engine process. Idempotent. */
  close(): Promise<void>;
}

export interface EngineAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities: EngineCapabilities;
  openSession(options: SessionOptions): EngineSession;
}
