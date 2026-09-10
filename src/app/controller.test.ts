import { describe, expect, it, vi } from 'vitest';
import type { EngineSession } from '../core/engine.js';
import type { ChatEvent } from '../core/events.js';
import { createChatController } from './controller.js';

function fixture(send: EngineSession['send']) {
  const persisted: ChatEvent[] = [];
  const session = { send, interrupt: vi.fn(async () => {}), close: vi.fn(async () => {}) };
  const openSession = vi.fn(() => session);
  const denyApprovals = vi.fn();
  const controller = createChatController({
    openSession, denyApprovals, transcript: { write: event => { persisted.push(event); } },
  });
  return { controller, persisted, session, openSession, denyApprovals };
}

const done: ChatEvent = { type: 'turn.completed', usage: null, costUsd: null, durationMs: 1 };

describe('chat lifecycle', () => {
  it('persists before rendering and reuses one session after clearing the view', async () => {
    const f = fixture(async function* () { yield done; });
    f.controller.subscribe(() => {
      for (const event of f.controller.snapshot().events) expect(f.persisted).toContain(event);
    });
    await f.controller.submit('first');
    f.controller.clear();
    await f.controller.submit('second');
    expect(f.openSession).toHaveBeenCalledTimes(1);
    expect(f.persisted.filter(event => event.type === 'user.message')).toHaveLength(2);
    expect(f.controller.snapshot().events).toHaveLength(2);
  });

  it('rejects overlapping turns, denies approvals on interrupt and closes once', async () => {
    let release!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; });
    const f = fixture(async function* () { await wait; yield done; });
    const active = f.controller.submit('one');
    await f.controller.submit('two');
    expect(f.persisted).toHaveLength(1);
    await f.controller.interrupt();
    expect(f.denyApprovals).toHaveBeenCalledOnce();
    release();
    await active;
    await Promise.all([f.controller.close(), f.controller.close()]);
    expect(f.session.close).toHaveBeenCalledOnce();
    await f.controller.submit('after close');
    expect(f.persisted.filter(event => event.type === 'user.message')).toHaveLength(1);
  });

  it('never starts the engine when the initial transcript write fails', async () => {
    const openSession = vi.fn();
    const controller = createChatController({
      openSession, denyApprovals: vi.fn(), transcript: { write: () => { throw new Error('Disk full'); } },
    });
    await controller.submit('write something');
    expect(openSession).not.toHaveBeenCalled();
    expect(controller.snapshot().events).toContainEqual(expect.objectContaining({ type: 'error' }));
    expect(controller.snapshot().busy).toBe(false);
  });

  it('reports a truncated stream instead of claiming completion', async () => {
    const f = fixture(async function* () {
      yield { type: 'text.delta', messageId: 'm', text: 'partial' };
    });
    await f.controller.submit('hello');
    expect(f.controller.snapshot().events.at(-1)?.type).toBe('error');
    expect(f.session.interrupt).toHaveBeenCalledOnce();
  });

  it('stores the user prompt once when the adapter echoes it', async () => {
    const f = fixture(async function* (text) {
      yield { type: 'user.message', text };
      yield done;
    });
    await f.controller.submit('hello');
    expect(f.persisted.filter(event => event.type === 'user.message')).toHaveLength(1);
  });

  it('waits for the active turn to settle before shutdown resolves', async () => {
    let release!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; });
    const f = fixture(async function* () { await wait; yield { type: 'turn.interrupted' }; });
    f.session.close.mockImplementation(async () => { release(); });
    const running = f.controller.submit('hello');
    await f.controller.close();
    expect(f.controller.snapshot().busy).toBe(false);
    expect(f.persisted.at(-1)?.type).toBe('turn.interrupted');
    await running;
  });
});
