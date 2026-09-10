// The TUI side of ApprovalBroker (src/core/approval.ts): the tool gate awaits `broker.request()`,
// the React tree renders `pending()` and answers with `respond()`. Requests queue in arrival
// order; an aborted signal (turn interrupted, session closed) resolves "deny" and drops the card.
import type { ApprovalBroker, ApprovalChoice, ApprovalRequest } from '../core/approval.js';

export interface PendingApproval {
  readonly id: string;
  readonly request: ApprovalRequest;
}

export type PendingListener = (pending: readonly PendingApproval[]) => void;

export interface ApprovalBridge {
  readonly broker: ApprovalBroker;
  /** Immutable snapshot; the same array until the queue changes (safe for useSyncExternalStore). */
  pending(): readonly PendingApproval[];
  /** Calls the listener on every queue change. Returns the unsubscribe function. */
  subscribe(listener: PendingListener): () => void;
  /** Answers one request. Unknown or already answered ids are ignored. */
  respond(id: string, choice: ApprovalChoice): void;
  /** Denies everything still waiting, e.g. on interrupt or exit, so no gate call hangs. */
  denyAll(): void;
}

interface Waiter {
  readonly entry: PendingApproval;
  readonly settle: (choice: ApprovalChoice) => void;
}

export function createApprovalBridge(): ApprovalBridge {
  let waiters: readonly Waiter[] = [];
  let snapshot: readonly PendingApproval[] = [];
  let nextId = 1;
  const listeners = new Set<PendingListener>();

  const publish = (next: readonly Waiter[]): void => {
    waiters = next;
    snapshot = next.map((waiter) => waiter.entry);
    for (const listener of listeners) listener(snapshot);
  };

  const settle = (id: string, choice: ApprovalChoice): void => {
    const waiter = waiters.find((candidate) => candidate.entry.id === id);
    if (!waiter) return;
    publish(waiters.filter((candidate) => candidate !== waiter));
    waiter.settle(choice);
  };

  const request = (approval: ApprovalRequest, signal?: AbortSignal): Promise<ApprovalChoice> => {
    if (signal?.aborted) return Promise.resolve('deny');
    const id = `approval-${nextId++}`;
    return new Promise<ApprovalChoice>((resolve) => {
      const onAbort = (): void => settle(id, 'deny');
      const finish = (choice: ApprovalChoice): void => {
        signal?.removeEventListener('abort', onAbort);
        resolve(choice);
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      publish([...waiters, { entry: { id, request: approval }, settle: finish }]);
    });
  };

  return {
    broker: { request },
    pending: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    respond: settle,
    denyAll: () => {
      for (const waiter of waiters) settle(waiter.entry.id, 'deny');
    },
  };
}
