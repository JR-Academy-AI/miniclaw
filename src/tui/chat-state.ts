// Pure reducer: engine ChatEvents + UI intents → chat view state. No I/O, no clock: callers
// pass `at` (epoch ms) with every action, so the reducer is deterministic and easy to test.
import type { EngineError } from '../core/errors.js';
import type { ChatEvent, Usage } from '../core/events.js';
import {
  appendStream, cancelRunningTools, findToolIndex, replaceAt, splitSettled,
  type ChatBlock, type Notice, type ToolBlock,
} from './chat-blocks.js';

export type Phase = 'idle' | 'running' | 'stopping';

export interface TokenTotals {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
}

interface TurnState {
  readonly userText: string | null;
  readonly userEchoed: boolean;
  readonly headerShown: boolean;
  /** Tool calls a human approved before the engine reported them as started. */
  readonly approvedIds: readonly string[];
}

export interface ChatState {
  /** Finished blocks, rendered once through Ink <Static>. */
  readonly committed: readonly ChatBlock[];
  /** Blocks of the turn in progress, re-rendered on every change. */
  readonly live: readonly ChatBlock[];
  readonly phase: Phase;
  /** True after the first prompt; the welcome screen then moves into the scrollback. */
  readonly started: boolean;
  /** Bumped by /clear so the <Static> transcript restarts from an empty list. */
  readonly epoch: number;
  readonly sessionId: string | null;
  readonly model: string | null;
  readonly totals: TokenTotals | null;
  /** Cumulative cost; stays null until the engine reports one. */
  readonly costUsd: number | null;
  readonly turnUsage: Usage | null;
  readonly turnCostUsd: number | null;
  readonly usageCompleteness: 'partial' | 'complete' | 'unavailable';
  readonly lastError: EngineError | null;
  readonly nextKey: number;
  readonly turn: TurnState;
}

export type ChatAction =
  | { readonly type: 'submitted'; readonly text: string; readonly at: number }
  | { readonly type: 'engine'; readonly event: ChatEvent; readonly at: number }
  | { readonly type: 'stop-requested' }
  | { readonly type: 'cleared' }
  | { readonly type: 'notice'; readonly notice: Notice };

const EMPTY_TURN: TurnState = { userText: null, userEchoed: false, headerShown: false, approvedIds: [] };

export const initialChatState: ChatState = {
  committed: [], live: [], phase: 'idle', started: false, epoch: 0,
  sessionId: null, model: null, totals: null, costUsd: null, lastError: null, nextKey: 1, turn: EMPTY_TURN,
  turnUsage: null, turnCostUsd: null, usageCompleteness: 'unavailable',
};

export function isBusy(state: ChatState): boolean {
  return state.phase !== 'idle';
}

export function sumTokens(usage: Usage | TokenTotals): number {
  return usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
}

/** Adds blocks to the live list and moves the settled prefix into the committed list. */
function withBlocks(state: ChatState, live: readonly ChatBlock[]): ChatState {
  const { settled, rest } = splitSettled(live);
  return { ...state, live: rest, committed: settled.length > 0 ? [...state.committed, ...settled] : state.committed };
}

/** Reserves `count` unique block keys. */
function takeKeys(state: ChatState, count: number): { state: ChatState; keys: string[] } {
  const keys = Array.from({ length: count }, (_, index) => `b${state.nextKey + index}`);
  return { state: { ...state, nextKey: state.nextKey + count }, keys };
}

function addBlock(state: ChatState, build: (key: string) => ChatBlock): ChatState {
  const { state: next, keys } = takeKeys(state, 1);
  return withBlocks(next, [...next.live, build(keys[0]!)]);
}

/** The first agent output of a turn gets a header with the model and the time. */
function ensureHeader(state: ChatState, at: number): ChatState {
  if (state.turn.headerShown) return state;
  const next = { ...state, turn: { ...state.turn, headerShown: true } };
  return addBlock(next, (key) => ({ kind: 'agent-header', key, model: state.model, at }));
}

function submit(state: ChatState, text: string): ChatState {
  const next: ChatState = {
    ...state, phase: 'running', started: true, lastError: null,
    turnUsage: null, turnCostUsd: null, usageCompleteness: 'unavailable',
    turn: { ...EMPTY_TURN, userText: text },
  };
  return addBlock(next, (key) => ({ kind: 'user', key, text }));
}

function endTurn(state: ChatState, at: number, build: ((key: string) => ChatBlock) | null): ChatState {
  const live = cancelRunningTools(state.live, at);
  const { state: keyed, keys } = takeKeys(state, 1);
  const finalLive = build ? [...live, build(keys[0]!)] : live;
  return { ...keyed, phase: 'idle', turn: EMPTY_TURN, live: [], committed: [...state.committed, ...finalLive] };
}

function addTotals(totals: TokenTotals | null, usage: Usage): TokenTotals {
  const base = totals ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  return {
    inputTokens: base.inputTokens + usage.inputTokens,
    outputTokens: base.outputTokens + usage.outputTokens,
    cacheReadTokens: base.cacheReadTokens + usage.cacheReadTokens,
    cacheWriteTokens: base.cacheWriteTokens + usage.cacheWriteTokens,
  };
}

function completeTurn(state: ChatState, event: Extract<ChatEvent, { type: 'turn.completed' }>, at: number): ChatState {
  const withUsage: ChatState = {
    ...state,
    totals: event.usage ? addTotals(state.totals, event.usage) : state.totals,
    costUsd: event.costUsd === null ? state.costUsd : (state.costUsd ?? 0) + event.costUsd,
    turnUsage: null, turnCostUsd: null,
    usageCompleteness: event.usage ? 'complete' : 'unavailable',
  };
  return endTurn(withUsage, at, (key) => ({
    kind: 'turn-meta', key, durationMs: event.durationMs,
    tokens: event.usage ? sumTokens(event.usage) : null, costUsd: event.costUsd,
  }));
}

function newToolBlock(key: string, fields: Pick<ToolBlock, 'toolUseId' | 'tool' | 'summary' | 'status' | 'detail' | 'startedAt'>): ToolBlock {
  return { kind: 'tool', key, approvedByUser: false, finishedAt: null, ...fields };
}

function startTool(state: ChatState, event: Extract<ChatEvent, { type: 'tool.started' }>, at: number): ChatState {
  const withHeader = ensureHeader(state, at);
  const index = findToolIndex(withHeader.live, event.toolUseId);
  const existing = withHeader.live[index];
  if (existing?.kind === 'tool') {
    return withBlocks(withHeader, replaceAt(withHeader.live, index, { ...existing, tool: event.tool, summary: event.summary }));
  }
  const approvedByUser = withHeader.turn.approvedIds.includes(event.toolUseId);
  return addBlock(withHeader, (key) => ({
    ...newToolBlock(key, { toolUseId: event.toolUseId, tool: event.tool, summary: event.summary, status: 'running', detail: null, startedAt: at }),
    approvedByUser,
  }));
}

function finishTool(state: ChatState, event: Extract<ChatEvent, { type: 'tool.finished' }>, at: number): ChatState {
  const index = findToolIndex(state.live, event.toolUseId);
  const existing = state.live[index];
  // A finish without a start has no tool name to show; the adapter contract always sends both.
  if (existing?.kind !== 'tool') return state;
  if (existing.status === 'denied') return withBlocks(state, replaceAt(state.live, index, { ...existing, finishedAt: at }));
  const finished: ToolBlock = { ...existing, status: event.ok ? 'ok' : 'error', detail: event.summary, finishedAt: at };
  return withBlocks(state, replaceAt(state.live, index, finished));
}

function applyDecision(state: ChatState, event: Extract<ChatEvent, { type: 'policy.decided' }>, at: number): ChatState {
  const index = findToolIndex(state.live, event.toolUseId, event.tool);
  const existing = state.live[index];
  if (event.verdict === 'allow') {
    if (event.resolvedBy !== 'user') return state;
    if (existing?.kind === 'tool') return withBlocks(state, replaceAt(state.live, index, { ...existing, approvedByUser: true }));
    if (event.toolUseId === null) return state;
    return { ...state, turn: { ...state.turn, approvedIds: [...state.turn.approvedIds, event.toolUseId] } };
  }
  if (existing?.kind === 'tool') {
    return withBlocks(state, replaceAt(state.live, index, { ...existing, status: 'denied', detail: event.reason, finishedAt: at }));
  }
  return addBlock(ensureHeader(state, at), (key) => ({
    ...newToolBlock(key, { toolUseId: event.toolUseId, tool: event.tool, summary: '', status: 'denied', detail: event.reason, startedAt: at }),
    finishedAt: null,
  }));
}

function echoUser(state: ChatState, text: string): ChatState {
  const isEcho = state.phase !== 'idle' && !state.turn.userEchoed && state.turn.userText === text;
  if (isEcho) return { ...state, turn: { ...state.turn, userEchoed: true } };
  return addBlock(state, (key) => ({ kind: 'user', key, text }));
}

function applyEvent(state: ChatState, event: ChatEvent, at: number): ChatState {
  switch (event.type) {
    case 'usage.updated': return { ...state, turnUsage: event.usage, turnCostUsd: event.costUsd, usageCompleteness: event.completeness };
    case 'user.message': return echoUser(state, event.text);
    case 'session.ready': return { ...state, sessionId: event.sessionId, model: event.model ?? state.model };
    case 'thinking.delta':
    case 'text.delta': {
      const withHeader = ensureHeader(state, at);
      const kind = event.type === 'text.delta' ? 'text' : 'thinking';
      const { state: keyed, keys } = takeKeys(withHeader, 1);
      const live = appendStream(keyed.live, { kind, messageId: event.messageId, text: event.text }, () => keys[0]!);
      return withBlocks(keyed, live);
    }
    case 'tool.started': return startTool(state, event, at);
    case 'tool.finished': return finishTool(state, event, at);
    case 'policy.decided': return applyDecision(state, event, at);
    case 'turn.completed': return completeTurn(state, event, at);
    case 'turn.interrupted': return endTurn(state, at, (key) => ({ kind: 'interrupted', key }));
    case 'error': return endTurn({ ...state, lastError: event.error }, at, (key) => ({ kind: 'error', key, error: event.error }));
  }
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'submitted': return submit(state, action.text);
    case 'engine': return applyEvent(state, action.event, action.at);
    case 'stop-requested': return state.phase === 'running' ? { ...state, phase: 'stopping' } : state;
    case 'cleared': return addBlock({ ...state, committed: [], epoch: state.epoch + 1 }, (key) => ({ kind: 'notice', key, notice: { type: 'cleared' } }));
    case 'notice': return addBlock(state, (key) => ({ kind: 'notice', key, notice: action.notice }));
  }
}
