import { describe, expect, it, vi } from 'vitest';
import type { ChatEvent } from '../../core/events.js';
import type { EngineSession } from '../../core/engine.js';
import { CodexCliAdapter } from './index.js';
import { AsyncQueue } from './queue.js';
import type { RpcClient, RpcMessage } from './rpc.js';
import { codexEnvironment, serverArgs, threadParams } from './options.js';
import { codexError, CodexTurn } from './translate.js';

function mockRpc(): RpcClient & { calls: RpcMessage[] } {
  const incoming = new AsyncQueue<RpcMessage>();
  const calls: RpcMessage[] = [];
  let turn = 0;
  let currentResult: RpcMessage | undefined;
  return { calls, notify: vi.fn(), respond: vi.fn(), reject: vi.fn(), close: vi.fn(), next: () => incoming.next(),
    request: async (method, params) => {
      calls.push({ method, params });
      if (method === 'initialize') return {};
      if (method === 'thread/start') return { thread: { id: 'thread-one' }, model: 'test-model',
        sandbox: { type: 'readOnly' }, approvalPolicy: 'never' };
      if (method === 'turn/interrupt') { if (currentResult) currentResult.status = 'interrupted'; return {}; }
      turn += 1;
      const turnId = `turn-${turn}`;
      const common = { threadId: 'thread-one', turnId };
      incoming.push({ id: 99, method: 'item/commandExecution/requestApproval', params: common });
      incoming.push({ id: 100, method: 'item/tool/call', params: common });
      incoming.push({ method: 'item/agentMessage/delta', params: { ...common, itemId: turnId, delta: 'pong' } });
      incoming.push({ method: 'item/completed', params: { ...common, item: { type: 'agentMessage', id: turnId, text: 'pong' } } });
      incoming.push({ method: 'thread/tokenUsage/updated', params: { ...common, tokenUsage: {
        total: { inputTokens: 100 * turn, cachedInputTokens: 20 * turn, outputTokens: 4 * turn },
      } } });
      currentResult = { id: turnId, status: 'completed', durationMs: 12 };
      incoming.push({ method: 'turn/completed', params: { threadId: 'thread-one', turn: currentResult } });
      return { turn: { id: turnId } };
    },
  };
}

function session(rpc: RpcClient): EngineSession {
  return new CodexCliAdapter({}, () => rpc).openSession({ cwd: '/tmp/test',
    toolGate: { check: async () => { throw new Error('Tools must stay disabled'); } } });
}
async function collect(engine: EngineSession): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  for await (const event of engine.send('hello')) events.push(event);
  return events;
}

describe('Codex app-server protocol contract (simulated transport, no model calls)', () => {
  it('retains one thread, streams text once, and differences cumulative usage', async () => {
    const rpc = mockRpc();
    const engine = session(rpc);
    const first = await collect(engine);
    const second = await collect(engine);
    expect(rpc.calls.filter((call) => call.method === 'thread/start')).toHaveLength(1);
    expect(rpc.calls.filter((call) => call.method === 'turn/start')).toHaveLength(2);
    for (const events of [first, second]) {
      expect(events.filter((event) => event.type === 'text.delta')).toEqual([{ type: 'text.delta', messageId: expect.any(String), text: 'pong' }]);
      expect(events.at(-1)).toMatchObject({ type: 'turn.completed', costUsd: null,
        usage: { inputTokens: 80, outputTokens: 4, cacheReadTokens: 20, cacheWriteTokens: 0 } });
    }
    await engine.close();
    await engine.close();
    expect(rpc.close).toHaveBeenCalledOnce();
  });

  it('declines approval and rejects unknown tool requests without consulting user grants', async () => {
    const rpc = mockRpc();
    await collect(session(rpc));
    expect(rpc.respond).toHaveBeenCalledWith(99, { decision: 'decline' });
    expect(rpc.reject).toHaveBeenCalledWith(100);
  });

  it('uses protocol interruption and closes the process when a consumer abandons the stream', async () => {
    const rpc = mockRpc();
    const engine = session(rpc);
    const iterator = engine.send('hello')[Symbol.asyncIterator]();
    await iterator.next();
    await iterator.next();
    await iterator.next();
    await engine.interrupt();
    expect(rpc.calls).toContainEqual({ method: 'turn/interrupt', params: { threadId: 'thread-one', turnId: 'turn-1' } });
    await iterator.return?.();
    expect(rpc.close).toHaveBeenCalledOnce(); // Abandoning a stream explicitly closes its process.
  });

  it('fails closed when server read-back disagrees with required sandbox', async () => {
    const rpc = mockRpc();
    const original = rpc.request;
    rpc.request = async (method, params) => method === 'thread/start'
      ? { thread: { id: 'unsafe' }, sandbox: { type: 'dangerFullAccess' }, approvalPolicy: 'never' }
      : original(method, params);
    const result = await collect(session(rpc));
    expect(result.at(-1)?.type).toBe('error');
    expect(rpc.calls.some((call) => call.method === 'turn/start')).toBe(false);
  });

  it('returns one interrupted terminal and successfully starts the next turn on the same thread', async () => {
    const rpc = mockRpc();
    const engine = session(rpc);
    const iterator = engine.send('hello')[Symbol.asyncIterator]();
    await iterator.next();
    await iterator.next();
    await iterator.next();
    await engine.interrupt();
    const remaining: ChatEvent[] = [];
    for (;;) {
      const result = await iterator.next();
      if (result.done) break;
      remaining.push(result.value);
    }
    expect(remaining.at(-1)).toEqual({ type: 'turn.interrupted' });
    expect((await collect(engine)).at(-1)?.type).toBe('turn.completed');
    expect(rpc.calls.filter((call) => call.method === 'thread/start')).toHaveLength(1);
  });

  it('returns unavailable cost/usage, interrupted and failed statuses truthfully', () => {
    const turn = new CodexTurn(null);
    expect(turn.snapshot('complete')).toEqual({ type: 'usage.updated', usage: null, costUsd: null, completeness: 'unavailable' });
    expect(turn.terminal({ status: 'interrupted' })).toEqual({ type: 'turn.interrupted' });
    expect(turn.terminal({ status: 'failed', error: { codexErrorInfo: 'usageLimitExceeded', message: 'Limit reached' } }))
      .toMatchObject({ type: 'error', error: { kind: 'QUOTA_EXHAUSTED' } });
    expect(codexError({ message: 'Bad token Bearer example-secret', codexErrorInfo: 'unauthorized' }))
      .toMatchObject({ kind: 'AUTH', message: 'Bad token [redacted]' });
  });

  it('explicitly disables environment/tools and excludes provider secrets from the child env', () => {
    const params = threadParams({ cwd: '/tmp/test' });
    expect(params.environments).toEqual([]);
    expect(params.dynamicTools).toEqual([]);
    expect(serverArgs()).toContain('mcp_servers={}');
    expect(serverArgs()).toContain('features.shell_tool=false');
    expect(serverArgs()).toContain('features.hooks=false');
    expect(serverArgs()).toContain('web_search="disabled"');
    const env = codexEnvironment({ HOME: '/home/test', OPENAI_API_KEY: 'not-a-real-key', CODEX_HOME: '/untrusted' });
    expect(env).toEqual({ HOME: '/home/test' });
  });
});
