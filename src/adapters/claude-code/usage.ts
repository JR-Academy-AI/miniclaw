// Per-turn usage from result messages (spike: fixtures/claude-code/*.jsonl).
// In streaming-input mode `modelUsage` and `total_cost_usd` are cumulative for the session,
// so a turn's usage is the difference from the previous result. `usage` on the result is
// per-turn but main-loop only (misses subagents, and is 0 on aborted streams), so it is
// only the fallback. Assistant messages repeat a non-final usage per content block and are
// never summed.
import type { Usage } from '../../core/events.js';
import { asRecord, readNumber, readRecord, type RawRecord } from './read.js';

export interface SessionTotals {
  readonly usage: Usage;
  readonly costUsd: number | null;
}

export interface TurnUsage {
  readonly usage: Usage | null;
  readonly costUsd: number | null;
}

const ZERO: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

function add(left: Usage, right: Usage): Usage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
    cacheWriteTokens: left.cacheWriteTokens + right.cacheWriteTokens,
  };
}

function subtract(current: Usage, previous: Usage): Usage | null {
  const delta = {
    inputTokens: current.inputTokens - previous.inputTokens,
    outputTokens: current.outputTokens - previous.outputTokens,
    cacheReadTokens: current.cacheReadTokens - previous.cacheReadTokens,
    cacheWriteTokens: current.cacheWriteTokens - previous.cacheWriteTokens,
  };
  return Object.values(delta).some((value) => value < 0) ? null : delta;
}

function fromModelUsage(entry: RawRecord | null): Usage {
  return {
    inputTokens: readNumber(entry, 'inputTokens') ?? 0,
    outputTokens: readNumber(entry, 'outputTokens') ?? 0,
    cacheReadTokens: readNumber(entry, 'cacheReadInputTokens') ?? 0,
    cacheWriteTokens: readNumber(entry, 'cacheCreationInputTokens') ?? 0,
  };
}

export function fromApiUsage(usage: RawRecord | null): Usage | null {
  if (usage === null) return null;
  return {
    inputTokens: readNumber(usage, 'input_tokens') ?? 0,
    outputTokens: readNumber(usage, 'output_tokens') ?? 0,
    cacheReadTokens: readNumber(usage, 'cache_read_input_tokens') ?? 0,
    cacheWriteTokens: readNumber(usage, 'cache_creation_input_tokens') ?? 0,
  };
}

export function hasUsage(usage: Usage | null): usage is Usage {
  return usage !== null && Object.values(usage).some((value) => value > 0);
}

/** Initial and final snapshots for one message replace each other, never add. */
export class LiveUsage {
  private readonly messages = new Map<string, Usage>();

  update(id: string, usage: RawRecord | null): Usage | null {
    const parsed = fromApiUsage(usage);
    const previous = this.messages.get(id);
    if (parsed) this.messages.set(id, {
      inputTokens: readNumber(usage, 'input_tokens') ?? previous?.inputTokens ?? 0,
      outputTokens: readNumber(usage, 'output_tokens') ?? previous?.outputTokens ?? 0,
      cacheReadTokens: readNumber(usage, 'cache_read_input_tokens') ?? previous?.cacheReadTokens ?? 0,
      cacheWriteTokens: readNumber(usage, 'cache_creation_input_tokens') ?? previous?.cacheWriteTokens ?? 0,
    });
    return this.total();
  }

  total(): Usage | null {
    if (this.messages.size === 0) return null;
    const total = [...this.messages.values()].reduce(add, ZERO);
    return hasUsage(total) ? total : null;
  }
}

/** Session running totals carried by a result message, or null when it has no modelUsage. */
export function readSessionTotals(result: RawRecord): SessionTotals | null {
  const models = Object.values(readRecord(result, 'modelUsage') ?? {});
  if (models.length === 0) return null;
  const usage = models.map((entry) => fromModelUsage(asRecord(entry))).reduce(add, ZERO);
  return { usage, costUsd: readNumber(result, 'total_cost_usd') };
}

function costDelta(current: number | null, previous: number | null): number | null {
  if (current === null) return null;
  const delta = current - (previous ?? 0);
  // A reset of the running total (e.g. engine-side /clear) makes the delta negative.
  return delta < 0 ? current : delta;
}

/** This turn's usage: current totals minus the previous result's totals. */
export function turnUsage(result: RawRecord, previous: SessionTotals | null): TurnUsage {
  const current = readSessionTotals(result);
  if (current === null) {
    const costUsd = costDelta(readNumber(result, 'total_cost_usd'), previous?.costUsd ?? null);
    return { usage: fromApiUsage(readRecord(result, 'usage')), costUsd };
  }
  const usage = previous === null ? current.usage : (subtract(current.usage, previous.usage) ?? current.usage);
  return { usage, costUsd: costDelta(current.costUsd, previous?.costUsd ?? null) };
}
