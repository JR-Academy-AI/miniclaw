import type { EngineAdapter, EngineCapabilities, EngineSession, SessionOptions } from '../../core/engine.js';
import { CodexSession, type RpcFactory } from './session.js';
import type { CodexCliOptions } from './options.js';

export class CodexCliAdapter implements EngineAdapter {
  readonly id = 'codex';
  readonly displayName = 'Codex';
  readonly capabilities: EngineCapabilities = { interrupt: true, streaming: true, reportsCost: false };

  constructor(private readonly config: CodexCliOptions = {}, private readonly factory?: RpcFactory) {}

  openSession(options: SessionOptions): EngineSession {
    return new CodexSession(options, { config: this.config, factory: this.factory });
  }
}
