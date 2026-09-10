import { describe, expect, it, vi } from 'vitest';
import type { ApprovalRequest } from '../core/approval.js';
import { createApprovalBridge } from './approval-bridge.js';

const bashRequest = (summary = 'run: npm test'): ApprovalRequest => ({
  toolUseId: 'tool-1',
  tool: 'Bash',
  summary,
  reason: 'Shell commands need your approval',
});

describe('createApprovalBridge', () => {
  it('queues a request and resolves with the chosen answer', async () => {
    const bridge = createApprovalBridge();
    const answer = bridge.broker.request(bashRequest());
    const [pending] = bridge.pending();
    expect(pending?.request.summary).toBe('run: npm test');

    bridge.respond(pending!.id, 'once');

    await expect(answer).resolves.toBe('once');
    expect(bridge.pending()).toEqual([]);
  });

  it('keeps concurrent requests in arrival order and answers each one separately', async () => {
    const bridge = createApprovalBridge();
    const first = bridge.broker.request(bashRequest('run: ls'));
    const second = bridge.broker.request(bashRequest('run: rm -rf build'));
    const [firstPending, secondPending] = bridge.pending();
    expect(bridge.pending().map((entry) => entry.request.summary)).toEqual(['run: ls', 'run: rm -rf build']);

    bridge.respond(secondPending!.id, 'deny');
    bridge.respond(firstPending!.id, 'session');

    await expect(first).resolves.toBe('session');
    await expect(second).resolves.toBe('deny');
  });

  it('resolves deny and removes the card when the signal aborts', async () => {
    const bridge = createApprovalBridge();
    const controller = new AbortController();
    const answer = bridge.broker.request(bashRequest(), controller.signal);
    expect(bridge.pending()).toHaveLength(1);

    controller.abort();

    await expect(answer).resolves.toBe('deny');
    expect(bridge.pending()).toEqual([]);
  });

  it('denies at once, without showing a card, when the signal is already aborted', async () => {
    const bridge = createApprovalBridge();
    const controller = new AbortController();
    controller.abort();

    await expect(bridge.broker.request(bashRequest(), controller.signal)).resolves.toBe('deny');
    expect(bridge.pending()).toEqual([]);
  });

  it('ignores a second answer for the same id', async () => {
    const bridge = createApprovalBridge();
    const answer = bridge.broker.request(bashRequest());
    const id = bridge.pending()[0]!.id;
    bridge.respond(id, 'deny');
    bridge.respond(id, 'once');
    await expect(answer).resolves.toBe('deny');
  });

  it('denyAll answers every waiting request with deny', async () => {
    const bridge = createApprovalBridge();
    const answers = [bridge.broker.request(bashRequest()), bridge.broker.request(bashRequest())];
    bridge.denyAll();
    await expect(Promise.all(answers)).resolves.toEqual(['deny', 'deny']);
    expect(bridge.pending()).toEqual([]);
  });

  it('notifies subscribers with a new snapshot on every change and stops after unsubscribe', () => {
    const bridge = createApprovalBridge();
    const listener = vi.fn();
    const unsubscribe = bridge.subscribe(listener);
    void bridge.broker.request(bashRequest());
    const snapshot = bridge.pending();
    expect(listener).toHaveBeenLastCalledWith(snapshot);
    expect(bridge.pending()).toBe(snapshot);

    unsubscribe();
    bridge.respond(snapshot[0]!.id, 'once');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
