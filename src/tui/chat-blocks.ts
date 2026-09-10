// View blocks for the chat transcript and the pure helpers that edit the live (in-progress) part.
// A block is one renderable row group; the reducer in chat-state.ts decides when blocks are added.
import type { EngineError } from '../core/errors.js';

export type ToolStatus = 'running' | 'ok' | 'error' | 'denied' | 'cancelled';

/** Things miniclaw says in the transcript itself; the component maps them to copy. */
export type Notice =
  | { readonly type: 'help' }
  | { readonly type: 'cleared' }
  | { readonly type: 'not-ready' }
  | { readonly type: 'unknown-command'; readonly name: string };

export interface ToolBlock {
  readonly kind: 'tool';
  readonly key: string;
  readonly toolUseId: string | null;
  readonly tool: string;
  readonly summary: string;
  readonly status: ToolStatus;
  /** Result summary when finished, or the policy reason when denied. */
  readonly detail: string | null;
  readonly approvedByUser: boolean;
  readonly startedAt: number;
  readonly finishedAt: number | null;
}

export type ChatBlock =
  | { readonly kind: 'user'; readonly key: string; readonly text: string }
  | { readonly kind: 'agent-header'; readonly key: string; readonly model: string | null; readonly at: number }
  | { readonly kind: 'thinking'; readonly key: string; readonly messageId: string; readonly text: string }
  | { readonly kind: 'text'; readonly key: string; readonly messageId: string; readonly text: string }
  | ToolBlock
  | { readonly kind: 'turn-meta'; readonly key: string; readonly durationMs: number; readonly tokens: number | null; readonly costUsd: number | null }
  | { readonly kind: 'interrupted'; readonly key: string }
  | { readonly kind: 'error'; readonly key: string; readonly error: EngineError }
  | { readonly kind: 'notice'; readonly key: string; readonly notice: Notice };

export type StreamKind = 'thinking' | 'text';

/** Appends a delta to the last live block of the same kind and message, or starts a new block. */
export function appendStream(
  live: readonly ChatBlock[],
  delta: { kind: StreamKind; messageId: string; text: string },
  makeKey: () => string,
): ChatBlock[] {
  const last = live.at(-1);
  if (last && last.kind === delta.kind && last.messageId === delta.messageId) {
    return [...live.slice(0, -1), { ...last, text: last.text + delta.text }];
  }
  return [...live, { kind: delta.kind, key: makeKey(), messageId: delta.messageId, text: delta.text }];
}

/**
 * Index of the live tool block an event refers to. Engines may omit toolUseId on policy events,
 * so a null id falls back to the most recent running call of the same tool.
 */
export function findToolIndex(live: readonly ChatBlock[], toolUseId: string | null, tool?: string): number {
  for (let index = live.length - 1; index >= 0; index -= 1) {
    const block = live[index]!;
    if (block.kind !== 'tool') continue;
    if (toolUseId !== null && block.toolUseId === toolUseId) return index;
    if (toolUseId === null && block.tool === tool && block.status === 'running') return index;
  }
  return -1;
}

export function replaceAt(live: readonly ChatBlock[], index: number, block: ChatBlock): ChatBlock[] {
  return live.map((candidate, position) => (position === index ? block : candidate));
}

/** Marks every still-running tool call as cancelled, used when a turn ends early. */
export function cancelRunningTools(live: readonly ChatBlock[], at: number): ChatBlock[] {
  return live.map((block) =>
    block.kind === 'tool' && block.status === 'running' ? { ...block, status: 'cancelled', finishedAt: at } : block);
}

function isSettled(block: ChatBlock, isLast: boolean): boolean {
  if (block.kind === 'tool') return block.status !== 'running' && block.finishedAt !== null;
  if (block.kind === 'thinking' || block.kind === 'text') return !isLast;
  return true;
}

/**
 * Splits live blocks into the settled prefix (safe to hand to Ink <Static>, never re-rendered)
 * and the rest. Only a prefix moves, so the transcript order never changes.
 */
export function splitSettled(live: readonly ChatBlock[]): { settled: ChatBlock[]; rest: ChatBlock[] } {
  let count = 0;
  while (count < live.length && isSettled(live[count]!, count === live.length - 1)) count += 1;
  return { settled: live.slice(0, count), rest: live.slice(count) };
}
