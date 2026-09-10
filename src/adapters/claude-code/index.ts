import type { EngineAdapter, EngineCapabilities, EngineSession, SessionOptions } from '../../core/engine.js';
import { ClaudeSession, type QueryFactory } from './session.js';
import type { ClaudeAdapterOptions } from './options.js';

export class ClaudeCodeAdapter implements EngineAdapter {
  readonly id = 'claude-code';
  readonly displayName = 'Claude Code';
  readonly capabilities: EngineCapabilities = { interrupt: true, streaming: true, reportsCost: true };

  constructor(private readonly options: ClaudeAdapterOptions = {}, private readonly createQuery?: QueryFactory) {}

  openSession(options: SessionOptions): EngineSession {
    return new ClaudeSession(options, { config: this.options, createQuery: this.createQuery });
  }
}
