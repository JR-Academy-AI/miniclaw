import type { EngineSession } from '../core/engine.js';
import type { ChatEvent, EventSink } from '../core/events.js';

export interface ChatSnapshot {
  readonly events: readonly ChatEvent[];
  readonly busy: boolean;
  readonly closed: boolean;
}

interface ControllerOptions {
  readonly openSession: () => EngineSession;
  readonly transcript: EventSink;
  readonly denyApprovals: () => void;
}

export interface ChatController {
  snapshot(): ChatSnapshot;
  subscribe(listener: () => void): () => void;
  submit(text: string): Promise<void>;
  interrupt(): Promise<void>;
  clear(): void;
  close(): Promise<void>;
  record(event: ChatEvent): void;
}

const terminal = (event: ChatEvent): boolean =>
  ['turn.completed', 'turn.interrupted', 'error'].includes(event.type);

function failure(error: unknown): ChatEvent {
  return { type: 'error', error: {
    kind: 'UNKNOWN', message: error instanceof Error ? error.message : 'The session failed.',
    hint: 'Check the transcript and retry. No automatic retry was performed.',
  } };
}

// 原则例外: the closure keeps session ownership private; each lifecycle operation remains small.
export function createChatController(options: ControllerOptions): ChatController {
  let state: ChatSnapshot = { events: [], busy: false, closed: false };
  let session: EngineSession | undefined;
  let closing: Promise<void> | undefined;
  let activeTurn: Promise<void> | undefined;
  const listeners = new Set<() => void>();
  const update = (patch: Partial<ChatSnapshot>): void => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const display = (event: ChatEvent): void => update({ events: [...state.events, event] });
  const record = (event: ChatEvent): void => { options.transcript.write(event); display(event); };

  const stop = async (): Promise<void> => {
    options.denyApprovals();
    await session?.interrupt();
  };

  const runTurn = async (text: string): Promise<void> => {
    if (!text.trim() || state.busy || state.closed) return;
    update({ busy: true });
    try {
      record({ type: 'user.message', text });
      session ??= options.openSession();
      let ended = false;
      for await (const event of session.send(text)) {
        if (event.type === 'user.message' && event.text === text) continue;
        record(event);
        if (terminal(event)) { ended = true; break; }
      }
      if (!ended && !state.closed) throw new Error('The engine stopped without a final result.');
    } catch (error) {
      options.denyApprovals();
      display(failure(error));
      try { await session?.interrupt(); } catch (stopError) { display(failure(stopError)); }
    } finally { update({ busy: false }); }
  };

  const close = (): Promise<void> => {
    if (closing) return closing;
    update({ closed: true });
    options.denyApprovals();
    closing = Promise.resolve().then(async () => { await session?.close(); await activeTurn; });
    return closing;
  };

  return {
    snapshot: () => state,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    submit: (text) => {
      if (state.busy || state.closed) return Promise.resolve();
      activeTurn = runTurn(text);
      return activeTurn;
    },
    interrupt: async () => { try { await stop(); } catch (error) { display(failure(error)); } },
    clear: () => { if (!state.busy) update({ events: [] }); },
    close,
    record,
  };
}
