import type { ChatEvent, Usage } from '../../core/events.js';
import type { EngineError, ErrorKind } from '../../core/errors.js';
import type { RpcMessage } from './rpc.js';

export const record = (value: unknown): RpcMessage => typeof value === 'object' && value !== null ? value as RpcMessage : {};
const number = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;

export function codexError(raw: unknown): EngineError {
  const entry = record(raw);
  const code = String(entry.codexErrorInfo ?? '');
  const text = String(entry.message ?? (raw instanceof Error ? raw.message : raw));
  let kind: ErrorKind = 'UNKNOWN';
  if (/unauthorized|auth|not logged in|401/i.test(`${code} ${text}`)) kind = 'AUTH';
  else if (/usageLimit|quota|usage limit|credit|billing/i.test(`${code} ${text}`)) kind = 'QUOTA_EXHAUSTED';
  else if (/rateLimit|rate limit|429/i.test(`${code} ${text}`)) kind = 'RATE_LIMITED';
  else if (/overload|529|503/i.test(`${code} ${text}`)) kind = 'OVERLOADED';
  else if (/network|connection|ECONN|ENOTFOUND|timed out/i.test(text)) kind = 'NETWORK';
  else if (/ENOENT|invalid|not found/i.test(text)) kind = 'INVALID_CONFIG';
  return { kind, message: text.replace(/Bearer\s+\S+|sk-[\w-]+/gi, '[redacted]').slice(0, 400),
    hint: kind === 'AUTH' ? 'Run `codex login`, then start a new chat.' : 'Start a new chat and try again.' };
}

export class CodexTurn {
  usage: Usage | null = null;
  totals: RpcMessage | null = null;
  private readonly streamed = new Set<string>();

  constructor(private readonly baseline: RpcMessage | null) {}

  events(message: RpcMessage): ChatEvent[] {
    const params = record(message.params);
    const itemId = String(params.itemId ?? '');
    if (message.method === 'item/agentMessage/delta') {
      this.streamed.add(itemId);
      return [{ type: 'text.delta', messageId: itemId, text: String(params.delta ?? '') }];
    }
    if (message.method === 'item/reasoning/summaryTextDelta' || message.method === 'item/reasoning/textDelta') {
      return [{ type: 'thinking.delta', messageId: itemId, text: String(params.delta ?? '') }];
    }
    if (message.method === 'thread/tokenUsage/updated') return this.updateUsage(params);
    if (message.method !== 'item/completed') return [];
    const item = record(params.item);
    if (item.type !== 'agentMessage' || this.streamed.has(String(item.id))) return [];
    return [{ type: 'text.delta', messageId: String(item.id), text: String(item.text ?? '') }];
  }

  private updateUsage(params: RpcMessage): ChatEvent[] {
    this.totals = record(record(params.tokenUsage).total);
    const delta = (key: string) => Math.max(0, number(this.totals?.[key]) - number(this.baseline?.[key]));
    const cacheReadTokens = delta('cachedInputTokens');
    const cacheWriteTokens = delta('cacheWriteInputTokens');
    const usage = { inputTokens: Math.max(0, delta('inputTokens') - cacheReadTokens - cacheWriteTokens),
      outputTokens: delta('outputTokens'), cacheReadTokens, cacheWriteTokens };
    this.usage = Object.values(usage).some((value) => value > 0) ? usage : null;
    return [this.snapshot('partial')];
  }

  snapshot(completeness: 'complete' | 'partial'): ChatEvent {
    return { type: 'usage.updated', usage: this.usage, costUsd: null,
      completeness: this.usage === null ? 'unavailable' : completeness };
  }

  terminal(turn: RpcMessage): ChatEvent {
    if (turn.status === 'interrupted') return { type: 'turn.interrupted' };
    if (turn.status !== 'completed') return { type: 'error', error: codexError(turn.error ?? 'Codex turn failed.') };
    return { type: 'turn.completed', usage: this.usage, costUsd: null, durationMs: number(turn.durationMs) };
  }
}
