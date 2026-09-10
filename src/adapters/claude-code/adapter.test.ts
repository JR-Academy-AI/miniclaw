import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { Options } from '@anthropic-ai/claude-agent-sdk';
import type { ChatEvent } from '../../core/events.js';
import type { EngineSession } from '../../core/engine.js';
import type { ToolRequest } from '../../core/tool-gate.js';
import { ClaudeCodeAdapter } from './index.js';
import { isolatedEnvironment, sdkOptions } from './options.js';
import type { ClaudeQuery, QueryFactory } from './session.js';
import { asRecord } from './read.js';
import { classifyFailure } from './classify.js';
import { LiveUsage } from './usage.js';

function fixture(name: string): unknown[] {
  return readFileSync(new URL(`../../../fixtures/claude-code/${name}.jsonl`, import.meta.url), 'utf8')
    .trim().split('\n').map((line) => JSON.parse(line));
}

function replay(name: string) {
  const events = fixture(name);
  const interrupt = vi.fn(async () => undefined);
  const close = vi.fn();
  const factory: QueryFactory = () => ({
    interrupt, close,
    async *[Symbol.asyncIterator]() { yield* events; },
  });
  const adapter = new ClaudeCodeAdapter({}, factory);
  const session = adapter.openSession({ cwd: '/tmp/miniclaw-contract',
    toolGate: { check: async () => ({ allowed: false, reason: 'offline test' }) } });
  return { session, interrupt, close };
}

async function collect(session: EngineSession, prompt = 'fixture replay'): Promise<ChatEvent[]> {
  const output: ChatEvent[] = [];
  for await (const event of session.send(prompt)) output.push(event);
  return output;
}

const text = (events: ChatEvent[]) => events.flatMap((event) => event.type === 'text.delta' ? [event.text] : []).join('');
const terminals = (events: ChatEvent[]) => events.filter((event) => ['turn.completed', 'turn.interrupted', 'error'].includes(event.type));

describe('real captured SDK messages replayed offline (no fresh paid requests)', () => {
  it('streams two turns without duplicate assistant text or double-counted cost', async () => {
    const { session } = replay('stream-multiturn');
    const first = await collect(session, 'Reply pong');
    const second = await collect(session, 'What did you reply?');
    expect(text(first)).toBe('pong');
    expect(text(second)).toBe('pong');
    expect(terminals(first)).toHaveLength(1);
    expect(terminals(second)).toHaveLength(1);
    expect(second.at(-1)).toMatchObject({ type: 'turn.completed', costUsd: expect.closeTo(0.0021945, 9) });
    const snapshots = first.filter((event) => event.type === 'usage.updated');
    expect(snapshots.some((event) => event.usage?.outputTokens === 45)).toBe(true);
    await session.close();
  });

  it('keeps thinking separate and emits tools/results once each', async () => {
    const thinking = await collect(replay('thinking').session);
    expect(thinking.some((event) => event.type === 'thinking.delta' && event.text.length > 0)).toBe(true);
    const gate = await collect(replay('gate').session);
    expect(gate.filter((event) => event.type === 'tool.started').map((event) => event.tool))
      .toEqual(['Bash', 'Bash', 'Read', 'Write']);
    expect(gate.filter((event) => event.type === 'tool.finished')).toHaveLength(4);
  });

  it.each(['interrupt', 'interrupt-hook'])('reports interruption then reuses the query: %s', async (name) => {
    const { session } = replay(name);
    const first = await collect(session);
    expect(terminals(first)).toEqual([{ type: 'turn.interrupted' }]);
    expect(first).toContainEqual(expect.objectContaining({ type: 'usage.updated', completeness: 'partial' }));
    const next = await collect(session);
    expect(text(next)).toBe('still-alive');
    expect(next.at(-1)?.type).toBe('turn.completed');
  });

  it('does not treat a success subtype or allowed rate-limit telemetry as success/failure respectively', async () => {
    const failure = await collect(replay('auth-invalid-key').session);
    expect(terminals(failure)).toEqual([expect.objectContaining({ type: 'error', error: expect.objectContaining({ kind: 'AUTH' }) })]);
    expect(text(failure)).toBe('');
    const normal = await collect(replay('thinking').session);
    expect(normal.at(-1)?.type).toBe('turn.completed');
  });
});

describe('deterministic simulated SDK lifecycle and option contract', () => {
  it('uses one input stream and aborts the in-flight approval signal on interrupt', async () => {
    let captured: Options | undefined;
    const interrupt = vi.fn(async () => undefined);
    const close = vi.fn();
    const factory: QueryFactory = ({ options }) => {
      captured = options;
      return { interrupt, close, async *[Symbol.asyncIterator]() { yield* fixture('stream-multiturn'); } };
    };
    const gate = vi.fn(async (_request: ToolRequest, _signal?: AbortSignal) => ({ allowed: true, reason: 'approved once' }));
    const session = new ClaudeCodeAdapter({}, factory).openSession({ cwd: '/tmp/test', toolGate: { check: gate } });
    const iterator = session.send('hello')[Symbol.asyncIterator]();
    await iterator.next();
    await session.interrupt();
    const hook = captured?.hooks?.PreToolUse?.[0]?.hooks[0];
    const result = await hook?.({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'echo x' },
      session_id: 'offline', transcript_path: '', cwd: '/tmp/test', tool_use_id: 'test' }, 'test', { signal: new AbortController().signal });
    expect(asRecord(asRecord(result)?.hookSpecificOutput)?.permissionDecision).toBe('deny');
    expect(gate.mock.calls[0]?.[1]?.aborted).toBe(true);
    expect(interrupt).toHaveBeenCalledOnce();
    await iterator.return?.();
    await session.close();
    await session.close();
    expect(close).toHaveBeenCalledOnce();
  });

  it('fails closed for gate exceptions and unexpected canUseTool fallback', async () => {
    const options = sdkOptions({}, { session: { cwd: '/tmp/test', toolGate: { check: async () => { throw new Error('offline failure'); } } },
      signal: () => new AbortController().signal });
    const hook = options.hooks?.PreToolUse?.[0]?.hooks[0];
    const result = await hook?.({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: {},
      session_id: 'offline', transcript_path: '', cwd: '/tmp/test', tool_use_id: 'test' }, 'test', { signal: new AbortController().signal });
    expect(asRecord(asRecord(result)?.hookSpecificOutput)?.permissionDecision).toBe('deny');
    expect(options.permissionMode).toBe('default');
    expect(options.allowedTools).toBeUndefined();
    expect(options.settingSources).toEqual([]);
    expect(options.mcpServers).toEqual({});
    expect(options.strictMcpConfig).toBe(true);
    expect(options.tools).not.toContain('Skill');
    expect(options.tools).not.toContain('Agent');
    const fallback = await options.canUseTool?.('Read', {}, { signal: new AbortController().signal,
      toolUseID: 'fallback', requestId: 'offline' });
    expect(fallback?.behavior).toBe('deny');
  });

  it('does not inherit provider env, retries or engine config paths', () => {
    const env = isolatedEnvironment({ HOME: '/home/test', PATH: '/bin', ANTHROPIC_API_KEY: 'test-only-placeholder',
      ANTHROPIC_BASE_URL: 'https://example.invalid', CLAUDE_CONFIG_DIR: '/evil', CLAUDE_CODE_RETRY_WATCHDOG: '1' });
    expect(env.HOME).toBe('/home/test');
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(env.CLAUDE_CONFIG_DIR).toBeUndefined();
    expect(env.CLAUDE_CODE_RETRY_WATCHDOG).toBe('0');
  });

  it('returns partial usage and one error when an SDK stream ends unexpectedly', async () => {
    const events = fixture('stream-multiturn').slice(0, 8);
    const runtime: ClaudeQuery = { interrupt: async () => undefined, close: vi.fn(),
      async *[Symbol.asyncIterator]() { yield* events; } };
    const session = new ClaudeCodeAdapter({}, () => runtime).openSession({ cwd: '/tmp/test',
      toolGate: { check: async () => ({ allowed: false, reason: 'offline' }) } });
    const result = await collect(session);
    expect(terminals(result)).toHaveLength(1);
    expect(result.at(-1)?.type).toBe('error');
    expect(result.at(-2)).toMatchObject({ type: 'usage.updated', completeness: 'partial' });
    expect(runtime.close).toHaveBeenCalledOnce();
  });

  it('preserves input/cache counts when a message delta only contains output tokens', () => {
    const usage = new LiveUsage();
    usage.update('one', { input_tokens: 10, output_tokens: 1, cache_read_input_tokens: 50 });
    usage.update('one', { output_tokens: 7 });
    usage.update('one', { output_tokens: 7 });
    expect(usage.total()).toEqual({ inputTokens: 10, outputTokens: 7, cacheReadTokens: 50, cacheWriteTokens: 0 });
  });

  it('marks a failed all-zero capture unavailable instead of free usage', async () => {
    const failure = await collect(replay('auth-invalid-key').session);
    expect(failure.at(-2)).toMatchObject({ type: 'usage.updated', usage: null, completeness: 'unavailable' });
  });
});

describe('document-based synthetic error examples (not real failure captures)', () => {
  it.each([
    ['QUOTA_EXHAUSTED', 429, 'enforced_spend_limit_reached'],
    ['RATE_LIMITED', 429, 'rate limit'], ['OVERLOADED', 529, 'overloaded'],
    ['NETWORK', null, 'ECONNRESET'], ['UNKNOWN', null, 'unrecognized failure'],
  ])('classifies %s without retrying', (kind, status, message) => {
    const error = classifyFailure({ errorCode: null, status: status as number | null, text: String(message), rateLimit: null });
    expect(error.kind).toBe(kind);
  });
});
