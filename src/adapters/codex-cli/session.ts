import type { EngineSession, SessionOptions } from '../../core/engine.js';
import type { ChatEvent } from '../../core/events.js';
import { threadParams, type CodexCliOptions } from './options.js';
import { StdioRpc, type RpcClient, type RpcMessage } from './rpc.js';
import { CodexTurn, codexError, record } from './translate.js';

export type RpcFactory = (options: CodexCliOptions, cwd: string) => RpcClient;

export class CodexSession implements EngineSession {
  private readonly rpc: RpcClient;
  private threadId: string | null = null;
  private turnId: string | null = null;
  private active = false;
  private closed = false;
  private interruptRequested = false;
  private totals: RpcMessage | null = null;

  constructor(private readonly session: SessionOptions, options: { config: CodexCliOptions; factory?: RpcFactory }) {
    this.config = options.config;
    this.rpc = (options.factory ?? ((config, cwd) => new StdioRpc(config, cwd)))(options.config, session.cwd);
  }
  private readonly config: CodexCliOptions;

  private async initialize(): Promise<ChatEvent | null> {
    if (this.threadId) return null;
    await this.rpc.request('initialize', { clientInfo: { name: 'miniclaw', version: '0.1.0' },
      capabilities: { experimentalApi: true } });
    this.rpc.notify('initialized');
    const response = await this.rpc.request('thread/start', threadParams({ cwd: this.session.cwd,
      model: this.session.model ?? this.config.model }));
    const id = record(response.thread).id;
    if (typeof id !== 'string') throw new Error('Codex thread/start returned no thread ID.');
    if (record(response.sandbox).type !== 'readOnly' || response.approvalPolicy !== 'never') {
      throw new Error('Codex did not apply the required text-only safety settings.');
    }
    this.threadId = id;
    return { type: 'session.ready', sessionId: id, cwd: this.session.cwd,
      model: typeof response.model === 'string' ? response.model : null };
  }

  async *send(prompt: string): AsyncGenerator<ChatEvent> {
    if (this.closed || this.active) {
      yield { type: 'error', error: codexError('Codex session is closed or already running.') }; return;
    }
    this.active = true;
    this.interruptRequested = false;
    const turn = new CodexTurn(this.totals);
    let terminal = false;
    try {
      const ready = await this.initialize();
      if (ready) yield ready;
      yield { type: 'user.message', text: prompt };
      const response = await this.rpc.request('turn/start', { threadId: this.threadId,
        input: [{ type: 'text', text: prompt, text_elements: [] }], environments: [] });
      this.turnId = String(record(response.turn).id ?? '');
      if (this.interruptRequested) await this.interrupt();
      for await (const event of this.readTurn(turn)) {
        if (['turn.completed', 'turn.interrupted', 'error'].includes(event.type)) terminal = true;
        yield event;
      }
    } catch (error) {
      yield turn.snapshot('partial');
      terminal = true;
      yield this.interruptRequested ? { type: 'turn.interrupted' } : { type: 'error', error: codexError(error) };
      await this.close();
    } finally {
      this.active = false;
      this.turnId = null;
      if (!terminal) await this.close();
    }
  }

  private async *readTurn(turn: CodexTurn): AsyncGenerator<ChatEvent> {
    for (;;) {
      const message = await this.rpc.next();
      if (message.id !== undefined && typeof message.method === 'string') { this.denyRequest(message); continue; }
      const params = record(message.params);
      if (params.threadId !== this.threadId) continue;
      if (params.turnId && params.turnId !== this.turnId) continue;
      if (message.method === 'turn/completed') {
        const result = record(params.turn);
        if (result.id !== this.turnId) continue;
        this.totals = turn.totals ?? this.totals;
        yield turn.snapshot(result.status === 'completed' ? 'complete' : 'partial');
        yield turn.terminal(result);
        return;
      }
      yield* turn.events(message);
    }
  }

  private denyRequest(message: RpcMessage): void {
    const method = String(message.method);
    if (method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval') {
      this.rpc.respond(message.id, { decision: 'decline' }); return;
    }
    if (method === 'execCommandApproval' || method === 'applyPatchApproval') {
      this.rpc.respond(message.id, { decision: 'denied' }); return;
    }
    // Unrecognized tool or auth requests are never implicitly successful.
    this.rpc.reject(message.id);
  }

  async interrupt(): Promise<void> {
    if (!this.active || this.closed) return;
    this.interruptRequested = true;
    if (!this.turnId || !this.threadId) return;
    await this.rpc.request('turn/interrupt', { threadId: this.threadId, turnId: this.turnId });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.rpc.close();
  }
}
