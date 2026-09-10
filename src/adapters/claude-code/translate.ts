import type { ChatEvent } from '../../core/events.js';
import type { RateLimitSnapshot } from './classify.js';
import { asRecord, readArray, readNumber, readRecord, readString, type RawRecord } from './read.js';
import { summarizeToolCall, summarizeToolResult } from './summary.js';
import { LiveUsage } from './usage.js';

/** Translation state resets each user turn, while the SDK query retains context. */
export class TurnTranslator {
  readonly liveUsage = new LiveUsage();
  errorCode: string | null = null;
  rateLimit: RateLimitSnapshot | null = null;
  private messageId = '';
  private readonly streamed = new Set<string>();
  private readonly tools = new Set<string>();

  constructor(private readonly cwd: string) {}

  translate(raw: RawRecord): ChatEvent[] {
    const type = readString(raw, 'type');
    if (type === 'stream_event') return this.stream(readRecord(raw, 'event'));
    if (type === 'assistant') return this.assistant(raw);
    if (type === 'user') return this.toolResults(readRecord(raw, 'message'));
    if (type === 'rate_limit_event') {
      const info = readRecord(raw, 'rate_limit_info');
      this.rateLimit = { status: readString(info, 'status') ?? '', resetsAt: readNumber(info, 'resetsAt') };
    }
    if (type !== 'system' || raw.subtype !== 'init') return [];
    return [{ type: 'session.ready', sessionId: readString(raw, 'session_id') ?? '',
      model: readString(raw, 'model'), cwd: this.cwd }];
  }

  private stream(event: RawRecord | null): ChatEvent[] {
    if (event?.type === 'message_start') {
      const message = readRecord(event, 'message');
      this.messageId = readString(message, 'id') ?? '';
      return this.usage(readRecord(message, 'usage'));
    }
    if (event?.type === 'message_delta') return this.usage(readRecord(event, 'usage'));
    if (event?.type !== 'content_block_delta') return [];
    const delta = readRecord(event, 'delta');
    const type = delta?.type === 'thinking_delta' ? 'thinking.delta' : 'text.delta';
    if (delta?.type !== 'thinking_delta' && delta?.type !== 'text_delta') return [];
    const text = readString(delta, type === 'thinking.delta' ? 'thinking' : 'text') ?? '';
    this.streamed.add(`${this.messageId}:${type}`);
    return text === '' ? [] : [{ type, messageId: this.messageId, text }];
  }

  private usage(usage: RawRecord | null): ChatEvent[] {
    if (!usage || !this.messageId) return [];
    return [{ type: 'usage.updated', usage: this.liveUsage.update(this.messageId, usage),
      costUsd: null, completeness: 'partial' }];
  }

  private assistant(raw: RawRecord): ChatEvent[] {
    this.errorCode = readString(raw, 'error') ?? this.errorCode;
    if (raw.is_api_error_message === true) return [];
    const message = readRecord(raw, 'message');
    const id = readString(message, 'id') ?? '';
    const events: ChatEvent[] = [];
    for (const value of readArray(message, 'content')) {
      const block = asRecord(value);
      if (block?.type === 'tool_use') events.push(...this.tool(block));
      if (block?.type === 'text' && !this.streamed.has(`${id}:text.delta`)) {
        events.push({ type: 'text.delta', messageId: id, text: readString(block, 'text') ?? '' });
      }
    }
    return events;
  }

  private tool(block: RawRecord): ChatEvent[] {
    const toolUseId = readString(block, 'id') ?? '';
    if (this.tools.has(toolUseId)) return [];
    this.tools.add(toolUseId);
    const tool = readString(block, 'name') ?? 'Unknown tool';
    return [{ type: 'tool.started', toolUseId, tool,
      summary: summarizeToolCall(tool, block.input, this.cwd) }];
  }

  private toolResults(message: RawRecord | null): ChatEvent[] {
    return readArray(message, 'content').flatMap((value): ChatEvent[] => {
      const block = asRecord(value);
      if (block?.type !== 'tool_result') return [];
      const ok = block.is_error !== true;
      return [{ type: 'tool.finished', toolUseId: readString(block, 'tool_use_id') ?? '',
        ok, summary: summarizeToolResult(block.content, ok) }];
    });
  }
}
