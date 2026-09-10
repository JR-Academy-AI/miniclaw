import { setTimeout as delay } from 'node:timers/promises';
import type { EngineAdapter, EngineSession, SessionOptions } from '../core/engine.js';
import type { ChatEvent } from '../core/events.js';

function demoSession(options: SessionOptions): EngineSession {
  let closed = false;
  let active: AbortController | undefined;
  let turns = 0;
  return {
    async *send(prompt) {
      if (closed) throw new Error('Demo session is closed.');
      active = new AbortController();
      const signal = active.signal;
      turns++;
      yield { type: 'session.ready', sessionId: 'demo', model: 'simulated · no API', cwd: options.cwd };
      if (/write|shell|approval/i.test(prompt)) yield* demoApproval(options, signal);
      const reply = `## Demo response\n\nThis is a **simulated engine**. No provider request was made.\n\n` +
        `Turn ${turns}: ${prompt}\n\nTry “write a file” to preview approval, or send a long prompt and press Esc.`;
      for (const word of reply.match(/\S+\s*/g) ?? []) {
        if (signal.aborted) { yield { type: 'turn.interrupted' }; return; }
        yield { type: 'text.delta', messageId: `demo-${turns}`, text: word };
        await delay(35);
      }
      yield { type: 'turn.completed', usage: null, costUsd: null, durationMs: 0 };
      active = undefined;
    },
    async interrupt() { active?.abort(); },
    async close() { closed = true; active?.abort(); },
  };
}

async function* demoApproval(options: SessionOptions, signal: AbortSignal): AsyncIterable<ChatEvent> {
  yield { type: 'tool.started', toolUseId: 'demo-write', tool: 'Write', summary: 'Demo only: write demo.txt' };
  const result = await options.toolGate.check({
    toolUseId: 'demo-write', tool: 'Write', input: { file_path: `${options.cwd}/demo.txt`, content: 'demo' },
  }, signal);
  yield { type: 'tool.finished', toolUseId: 'demo-write', ok: result.allowed,
    summary: result.allowed ? 'Approved; demo performs no filesystem write.' : result.reason };
}

export const demoAdapter: EngineAdapter = {
  id: 'demo', displayName: 'Simulated engine (no API)',
  capabilities: { interrupt: true, streaming: true, reportsCost: false },
  openSession: demoSession,
};
