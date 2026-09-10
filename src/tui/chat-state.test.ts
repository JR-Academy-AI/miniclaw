import { describe, expect, it } from 'vitest';
import type { ChatEvent } from '../core/events.js';
import type { ChatBlock } from './chat-blocks.js';
import { chatReducer, initialChatState, isBusy, type ChatAction, type ChatState } from './chat-state.js';

const AT = 1_000;
const submitted = (text: string): ChatAction => ({ type: 'submitted', text, at: AT });
const engine = (event: ChatEvent, at = AT): ChatAction => ({ type: 'engine', event, at });
const text = (messageId: string, value: string): ChatAction => engine({ type: 'text.delta', messageId, text: value });
const thinking = (messageId: string, value: string): ChatAction => engine({ type: 'thinking.delta', messageId, text: value });
const toolStarted = (toolUseId: string, tool = 'Bash', summary = 'npm test'): ChatAction =>
  engine({ type: 'tool.started', toolUseId, tool, summary });
const toolFinished = (toolUseId: string, ok = true, summary = 'exit 0', at = AT + 800): ChatAction =>
  engine({ type: 'tool.finished', toolUseId, ok, summary }, at);
const usage = { inputTokens: 10, outputTokens: 20, cacheReadTokens: 30, cacheWriteTokens: 40 };
const completed = (costUsd: number | null = 0.01): ChatAction =>
  engine({ type: 'turn.completed', usage, costUsd, durationMs: 2_000 });
const decided = (fields: Partial<Extract<ChatEvent, { type: 'policy.decided' }>>): ChatAction =>
  engine({ type: 'policy.decided', toolUseId: 't1', tool: 'Bash', verdict: 'deny', reason: 'hard floor', ruleId: 'r', resolvedBy: 'rule', ...fields });

const run = (...actions: ChatAction[]): ChatState => actions.reduce(chatReducer, initialChatState);
const kinds = (blocks: readonly ChatBlock[]): string[] => blocks.map((block) => block.kind);
const allBlocks = (state: ChatState): ChatBlock[] => [...state.committed, ...state.live];
const toolBlock = (state: ChatState) => allBlocks(state).find((block) => block.kind === 'tool');

describe('chatReducer: submitting', () => {
  it('commits the user message at once and marks the chat busy', () => {
    const state = run(submitted('hello'));
    expect(kinds(state.committed)).toEqual(['user']);
    expect(state.live).toEqual([]);
    expect(isBusy(state)).toBe(true);
    expect(state.started).toBe(true);
  });

  it('ignores the engine echo of the prompt that was just sent, but shows other user messages', () => {
    const echoed = run(submitted('hello'), engine({ type: 'user.message', text: 'hello' }));
    expect(kinds(allBlocks(echoed))).toEqual(['user']);
    const replayed = run(engine({ type: 'user.message', text: 'from transcript' }));
    expect(kinds(allBlocks(replayed))).toEqual(['user']);
  });
});

describe('chatReducer: streaming', () => {
  it('accumulates text deltas per messageId in one live block under one header', () => {
    const state = run(submitted('hi'), text('m1', 'Hel'), text('m1', 'lo '), text('m1', 'world'));
    expect(kinds(state.committed)).toEqual(['user', 'agent-header']);
    expect(state.live).toEqual([expect.objectContaining({ kind: 'text', messageId: 'm1', text: 'Hello world' })]);
  });

  it('starts a new block for a new messageId and commits the finished one', () => {
    const state = run(submitted('hi'), text('m1', 'first'), text('m2', 'second'));
    expect(kinds(state.committed)).toEqual(['user', 'agent-header', 'text']);
    expect(state.live).toEqual([expect.objectContaining({ messageId: 'm2', text: 'second' })]);
  });

  it('keeps thinking separate from the reply and settles it once the reply starts', () => {
    const state = run(submitted('hi'), thinking('m1', 'Let me '), thinking('m1', 'think'), text('m1', 'Answer'));
    const thought = state.committed.find((block) => block.kind === 'thinking');
    expect(thought).toMatchObject({ text: 'Let me think' });
    expect(kinds(state.live)).toEqual(['text']);
  });

  it('uses the model from session.ready in the agent header and timestamps it', () => {
    const state = run(
      submitted('hi'),
      engine({ type: 'session.ready', sessionId: 's1', model: 'claude-sonnet-4-5', cwd: '/tmp/w' }),
      text('m1', 'ok'),
    );
    expect(state.committed.find((block) => block.kind === 'agent-header')).toMatchObject({ model: 'claude-sonnet-4-5', at: AT });
    expect(state.sessionId).toBe('s1');
    expect(state.model).toBe('claude-sonnet-4-5');
  });

  it('keeps block keys unique across the whole transcript', () => {
    const state = run(submitted('a'), text('m1', 'x'), toolStarted('t1'), toolFinished('t1'), text('m2', 'y'), completed());
    const keys = allBlocks(state).map((block) => block.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('chatReducer: tool calls', () => {
  it('shows a running tool row, then finishes it with the result and timing', () => {
    const running = run(submitted('test it'), text('m1', 'Running tests.'), toolStarted('t1'));
    expect(kinds(running.committed)).toEqual(['user', 'agent-header', 'text']);
    expect(running.live).toEqual([expect.objectContaining({ kind: 'tool', status: 'running', tool: 'Bash', summary: 'npm test', startedAt: AT })]);

    const finished = chatReducer(running, toolFinished('t1'));
    expect(toolBlock(finished)).toMatchObject({ status: 'ok', detail: 'exit 0', finishedAt: AT + 800 });
    expect(finished.live).toEqual([]);
  });

  it('marks a failed tool as error', () => {
    expect(toolBlock(run(submitted('x'), toolStarted('t1'), toolFinished('t1', false, 'exit 1')))).toMatchObject({ status: 'error', detail: 'exit 1' });
  });

  it('holds later blocks back while an earlier tool is still running, so order never changes', () => {
    const state = run(submitted('x'), toolStarted('t1'), toolStarted('t2', 'Read', 'a.ts'), toolFinished('t2'));
    expect(kinds(state.committed)).toEqual(['user', 'agent-header']);
    expect(state.live.map((block) => (block.kind === 'tool' ? block.toolUseId : block.kind))).toEqual(['t1', 't2']);
    const released = chatReducer(state, toolFinished('t1'));
    expect(kinds(released.committed)).toEqual(['user', 'agent-header', 'tool', 'tool']);
  });

  it('ignores a finish for a tool it never saw start', () => {
    const state = run(submitted('x'));
    expect(chatReducer(state, toolFinished('ghost'))).toBe(state);
  });
});

describe('chatReducer: policy decisions', () => {
  it('marks a started tool as denied with the policy reason, and a later failure keeps it denied', () => {
    const state = run(submitted('x'), toolStarted('t1'), decided({ reason: 'reads ~/.ssh' }), toolFinished('t1', false, 'blocked'));
    expect(toolBlock(state)).toMatchObject({ status: 'denied', detail: 'reads ~/.ssh' });
  });

  it('shows a denial that arrives before the tool starts, then fills in the summary', () => {
    const state = run(submitted('x'), decided({ reason: 'hard floor' }), toolStarted('t1', 'Read', '~/.ssh/id_rsa'));
    expect(allBlocks(state).filter((block) => block.kind === 'tool')).toHaveLength(1);
    expect(toolBlock(state)).toMatchObject({ status: 'denied', summary: '~/.ssh/id_rsa', detail: 'hard floor' });
  });

  it('matches a decision without toolUseId to the latest running call of the same tool', () => {
    const state = run(submitted('x'), toolStarted('t1', 'Bash'), decided({ toolUseId: null, tool: 'Bash' }));
    expect(toolBlock(state)).toMatchObject({ toolUseId: 't1', status: 'denied' });
  });

  it('records a human approval whether it arrives before or after tool.started', () => {
    const after = run(submitted('x'), toolStarted('t1'), decided({ verdict: 'allow', resolvedBy: 'user' }));
    expect(toolBlock(after)).toMatchObject({ approvedByUser: true, status: 'running' });
    const before = run(submitted('x'), decided({ verdict: 'allow', resolvedBy: 'user' }), toolStarted('t1'));
    expect(toolBlock(before)).toMatchObject({ approvedByUser: true });
  });

  it('shows nothing extra for a call policy allowed on its own', () => {
    const state = run(submitted('x'), toolStarted('t1'));
    expect(chatReducer(state, decided({ verdict: 'allow', resolvedBy: 'rule' }))).toBe(state);
  });
});

describe('chatReducer: ending a turn', () => {
  it('completes a turn: idle again, everything committed, a meta row with tokens and cost', () => {
    const state = run(submitted('x'), text('m1', 'done'), completed(0.02));
    expect(isBusy(state)).toBe(false);
    expect(state.live).toEqual([]);
    expect(state.committed.at(-1)).toMatchObject({ kind: 'turn-meta', tokens: 100, costUsd: 0.02, durationMs: 2_000 });
  });

  it('accumulates tokens and cost across turns, and keeps cost null until one is reported', () => {
    const noCost = run(submitted('a'), completed(null));
    expect(noCost.costUsd).toBeNull();
    expect(noCost.totals).toEqual(usage);
    const twoTurns = run(submitted('a'), completed(null), submitted('b'), completed(0.5), submitted('c'), completed(0.25));
    expect(twoTurns.costUsd).toBeCloseTo(0.75);
    expect(twoTurns.totals?.outputTokens).toBe(60);
  });

  it('leaves totals untouched when a turn reports no usage', () => {
    const state = run(submitted('a'), engine({ type: 'turn.completed', usage: null, costUsd: null, durationMs: 5 }));
    expect(state.totals).toBeNull();
    expect(state.committed.at(-1)).toMatchObject({ kind: 'turn-meta', tokens: null });
  });

  it('goes to stopping on an interrupt request, then shows the interrupted marker and cancels running tools', () => {
    const stopping = run(submitted('x'), toolStarted('t1'), { type: 'stop-requested' });
    expect(stopping.phase).toBe('stopping');
    const ended = chatReducer(stopping, engine({ type: 'turn.interrupted' }, AT + 5));
    expect(ended.phase).toBe('idle');
    expect(toolBlock(ended)).toMatchObject({ status: 'cancelled', finishedAt: AT + 5 });
    expect(kinds(ended.committed).at(-1)).toBe('interrupted');
  });

  it('ignores an interrupt request when nothing is running', () => {
    expect(chatReducer(initialChatState, { type: 'stop-requested' })).toBe(initialChatState);
  });

  it('shows an error block, remembers the last error and clears it on the next prompt', () => {
    const error = { kind: 'AUTH' as const, message: 'Not logged in', hint: 'Run: claude /login' };
    const failed = run(submitted('x'), text('m1', 'partial'), engine({ type: 'error', error }));
    expect(failed.phase).toBe('idle');
    expect(failed.lastError).toEqual(error);
    expect(failed.committed.at(-1)).toMatchObject({ kind: 'error', error });
    expect(chatReducer(failed, submitted('again')).lastError).toBeNull();
  });
});

describe('chatReducer: UI intents', () => {
  it('clears the view: empties the transcript, restarts <Static> and says the context is kept', () => {
    const state = run(submitted('x'), completed(), { type: 'cleared' });
    expect(state.epoch).toBe(1);
    expect(state.committed).toEqual([expect.objectContaining({ kind: 'notice', notice: { type: 'cleared' } })]);
    expect(state.totals).toEqual(usage);
  });

  it('adds a notice such as /help to the transcript', () => {
    const state = run({ type: 'notice', notice: { type: 'help' } });
    expect(state.committed).toEqual([expect.objectContaining({ kind: 'notice', notice: { type: 'help' } })]);
    expect(state.started).toBe(false);
  });
});
