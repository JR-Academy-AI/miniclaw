import { query, type Options, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { EngineSession, SessionOptions } from '../../core/engine.js';
import type { ChatEvent } from '../../core/events.js';
import { classifyFailure, classifyThrown } from './classify.js';
import { PromptQueue } from './input.js';
import { sdkOptions, type ClaudeAdapterOptions } from './options.js';
import { asRecord, readNumber, readString, type RawRecord } from './read.js';
import { TurnTranslator } from './translate.js';
import { hasUsage, readSessionTotals, turnUsage, type SessionTotals } from './usage.js';

export interface ClaudeQuery extends AsyncIterable<unknown> {
  interrupt(): Promise<unknown>;
  close(): void;
}
export type QueryFactory = (request: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => ClaudeQuery;

export class ClaudeSession implements EngineSession {
  private readonly prompts = new PromptQueue();
  private readonly runtime: ClaudeQuery;
  private readonly iterator: AsyncIterator<unknown>;
  private active = false;
  private closed = false;
  private interrupted = false;
  private controller = new AbortController();
  private previous: SessionTotals | null = null;

  constructor(session: SessionOptions, dependencies: { config: ClaudeAdapterOptions; createQuery?: QueryFactory }) {
    this.cwd = session.cwd;
    const options = sdkOptions(dependencies.config, { session, signal: () => this.controller.signal });
    this.runtime = (dependencies.createQuery ?? query)({ prompt: this.prompts, options });
    this.iterator = this.runtime[Symbol.asyncIterator]();
  }
  private readonly cwd: string;

  async *send(prompt: string): AsyncGenerator<ChatEvent> {
    if (this.closed || this.active) {
      yield { type: 'error', error: { kind: 'INVALID_CONFIG',
        message: this.closed ? 'This chat is closed. Start a new chat.' : 'A response is already running.' } };
      return;
    }
    this.active = true;
    this.interrupted = false;
    this.controller = new AbortController();
    const translator = new TurnTranslator(this.cwd);
    const started = Date.now();
    let terminal = false;
    try {
      this.prompts.push(prompt);
      yield { type: 'user.message', text: prompt };
      for await (const event of this.readTurn({ translator, started })) {
        if (['turn.completed', 'turn.interrupted', 'error'].includes(event.type)) terminal = true;
        yield event;
      }
    } catch (error) {
      yield { type: 'usage.updated', usage: translator.liveUsage.total(), costUsd: null,
        completeness: translator.liveUsage.total() ? 'partial' : 'unavailable' };
      terminal = true;
      yield this.interrupted ? { type: 'turn.interrupted' } : { type: 'error', error: classifyThrown(error, '') };
      await this.close();
    } finally {
      this.active = false;
      if (!terminal) await this.close(); // Abandoned consumers must not leave tools running.
    }
  }

  private async *readTurn(context: { translator: TurnTranslator; started: number }): AsyncGenerator<ChatEvent> {
    for (;;) {
      const { value, done } = await this.iterator.next();
      if (done) throw new Error('Claude ended its stream before returning a result. Start a new chat.');
      const raw = asRecord(value);
      if (!raw) continue;
      if (raw.type === 'result') {
        yield* this.finish(raw, context);
        return;
      }
      yield* context.translator.translate(raw);
    }
  }

  private finish(raw: RawRecord, context: { translator: TurnTranslator; started: number }): ChatEvent[] {
    const current = turnUsage(raw, this.previous);
    this.previous = readSessionTotals(raw) ?? this.previous;
    const aborted = this.interrupted || String(raw.terminal_reason).startsWith('aborted_');
    const partial = context.translator.liveUsage.total();
    const usage = aborted ? partial : hasUsage(current.usage) ? current.usage : null;
    const completeness = !usage ? 'unavailable' : aborted || raw.is_error === true ? 'partial' : 'complete';
    const updated: ChatEvent = { type: 'usage.updated', usage, costUsd: current.costUsd, completeness };
    if (aborted) return [updated, { type: 'turn.interrupted' }];
    if (raw.is_error === true || raw.subtype !== 'success') {
      const text = readString(raw, 'result') ?? (Array.isArray(raw.errors) ? raw.errors.join(' ') : '');
      return [updated, { type: 'error', error: classifyFailure({ errorCode: context.translator.errorCode,
        status: readNumber(raw, 'api_error_status'), text, rateLimit: context.translator.rateLimit }) }];
    }
    return [updated, { type: 'turn.completed', usage, costUsd: current.costUsd,
      durationMs: readNumber(raw, 'duration_ms') ?? Date.now() - context.started }];
  }

  async interrupt(): Promise<void> {
    if (!this.active || this.closed) return;
    this.interrupted = true;
    this.controller.abort();
    await this.runtime.interrupt();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.interrupted = this.active;
    this.controller.abort();
    this.prompts.close();
    this.runtime.close();
  }
}
