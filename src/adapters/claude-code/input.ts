import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

/** One stream for the lifetime of a query; subsequent prompts keep engine context. */
export class PromptQueue implements AsyncIterable<SDKUserMessage> {
  private readonly pending: SDKUserMessage[] = [];
  private wake: (() => void) | undefined;
  private closed = false;

  push(text: string): void {
    if (this.closed) throw new Error('The Claude session is closed. Start a new chat.');
    this.pending.push({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null });
    this.wake?.();
  }

  close(): void {
    this.closed = true;
    this.wake?.();
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<SDKUserMessage> {
    for (;;) {
      const item = this.pending.shift();
      if (item) { yield item; continue; }
      if (this.closed) return;
      await new Promise<void>((resolve) => { this.wake = resolve; });
      this.wake = undefined;
    }
  }
}
