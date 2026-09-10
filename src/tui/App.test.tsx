import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, cleanup } from 'ink-testing-library';
import type { Key } from 'ink';
import { App, type AppProps } from './App.js';
import { createApprovalBridge } from './approval-bridge.js';
import { chatReducer, initialChatState } from './chat-state.js';
import { approvalKey, editInput, emptyEditor, hasNewlineIntent, isReturnInput } from './input.js';
import { createTheme, displayWidth, type ColorDepth } from './theme/index.js';

afterEach(cleanup);
const tick = () => new Promise((resolve) => setTimeout(resolve, 40));
const request = { toolUseId: 'tool-1', tool: 'Write', summary: 'Write draft.md', reason: 'File writes need permission' };
const key = (fields: Partial<Key> = {}): Key => ({
  upArrow: false, downArrow: false, leftArrow: false, rightArrow: false,
  pageDown: false, pageUp: false, home: false, end: false, return: false,
  escape: false, ctrl: false, shift: false, tab: false, backspace: false,
  delete: false, meta: false, super: false, hyper: false, capsLock: false, numLock: false, ...fields,
});
function props(): AppProps {
  return { theme: createTheme({ env: { NO_COLOR: '1', MINICLAW_ASCII: '1' }, isTTY: false }),
    state: initialChatState, busy: false, approvals: createApprovalBridge(),
    detection: { engineId: 'claude', ready: true, steps: [], executablePath: '/fixture/claude', version: 'fixture', fix: null },
    workspace: '/fixture/workspace', transcriptPath: '/fixture/events.jsonl',
    onSubmit: vi.fn(), onInterrupt: vi.fn(), onExit: vi.fn() };
}

describe('approval keyboard boundary', () => {
  it('Enter always denies and navigation never approves', () => {
    expect(approvalKey('a', key({ return: true }))).toBe('deny');
    expect(approvalKey('', key({ rightArrow: true }))).toBeNull();
    expect(approvalKey('a', key())).toBe('once');
    expect(approvalKey('s', key())).toBe('session');
  });
  it('a pending rendered approval owns input; Enter denies without submitting', async () => {
    const input = props();
    const answer = input.approvals.broker.request(request);
    const screen = render(<App {...input} />);
    await tick();
    expect(screen.lastFrame()).toContain('Default is deny');
    screen.stdin.write('\r');
    await expect(answer).resolves.toBe('deny');
    expect(input.onSubmit).not.toHaveBeenCalled();
  });
  it('Ctrl+C denies pending approvals and requests lifecycle cleanup', async () => {
    const input = props();
    const answer = input.approvals.broker.request(request);
    const screen = render(<App {...input} />);
    await tick(); screen.stdin.write('\x03'); await tick();
    await expect(answer).resolves.toBe('deny');
    expect(input.onExit).toHaveBeenCalledOnce();
  });
  it('Esc denies pending approvals and interrupts the running turn', async () => {
    const input = props();
    const answer = input.approvals.broker.request(request);
    const screen = render(<App {...input} />);
    await tick(); screen.stdin.write('\x1b'); await tick();
    await expect(answer).resolves.toBe('deny');
    expect(input.onInterrupt).toHaveBeenCalledOnce();
  });
});

describe('composer', () => {
  it.each(['\r', '\n', '\r\n'])('recognizes raw return %j without interpreting pasted lines as submission', (input) => {
    expect(isReturnInput(input, key())).toBe(true);
    expect(approvalKey(input, key())).toBe('deny');
    expect(isReturnInput('/help\nmore', key())).toBe(false);
  });
  it.each(['\x08', '\x7f'])('deletes backwards for raw control byte %j', (input) => {
    expect(editInput({ text: '/helpp', cursor: 6 }, input, key())).toEqual({ text: '/help', cursor: 5 });
    expect(editInput(emptyEditor, input, key())).toEqual(emptyEditor);
  });
  it('supports forward deletion with Ctrl+D', () => {
    expect(editInput({ text: 'acb', cursor: 1 }, 'd', key({ ctrl: true }))).toEqual({ text: 'ab', cursor: 1 });
  });
  it.each(['\r', '\n', '\r\n'])('submits rapidly typed slash commands with %j without dropping characters', async (enter) => {
    const input = props();
    const screen = render(<App {...input} />);
    await tick();
    for (const character of '/help') screen.stdin.write(character);
    screen.stdin.write(enter);
    await tick();
    expect(input.onSubmit).toHaveBeenCalledExactlyOnceWith('/help');
  });
  it('clears the buffer synchronously between successive slash commands', async () => {
    const input = props();
    const screen = render(<App {...input} />);
    await tick();
    for (const command of ['/help', '/clear', '/exit']) {
      screen.stdin.write(command); screen.stdin.write('\r');
    }
    await tick();
    expect(vi.mocked(input.onSubmit).mock.calls).toEqual([['/help'], ['/clear'], ['/exit']]);
  });
  it.each(['\x08', '\x7f'])('corrects slash commands with actual terminal byte %j', async (backspace) => {
    const input = props();
    const screen = render(<App {...input} />);
    await tick(); screen.stdin.write('/helpp'); screen.stdin.write(backspace); screen.stdin.write('\r'); await tick();
    expect(input.onSubmit).toHaveBeenCalledExactlyOnceWith('/help');
  });
  it('preserves pasted multiline content and supports cursor edits', () => {
    let editor = editInput(emptyEditor, 'first\nsecond', key());
    editor = editInput(editor, '', key({ leftArrow: true }));
    editor = editInput(editor, '!', key());
    expect(editor.text).toBe('first\nsecon!d');
    expect(hasNewlineIntent(editor, key({ return: true, meta: true }))).toBe(true);
    expect(hasNewlineIntent({ text: 'line\\', cursor: 5 }, key({ return: true }))).toBe(true);
    expect(isReturnInput('\r', key())).toBe(true);
    expect(isReturnInput('\n', key())).toBe(true);
    expect(isReturnInput('pasted\ntext', key())).toBe(false);
  });
  it('sends text, dispatches commands and interrupts without submitting another prompt', async () => {
    const input = props();
    const screen = render(<App {...input} />);
    await tick(); screen.stdin.write('/help'); await tick(); screen.stdin.write('\r'); await tick();
    expect(input.onSubmit).toHaveBeenCalledWith('/help');
    screen.stdin.write('\x1b'); await tick();
    expect(input.onInterrupt).toHaveBeenCalledOnce();
  });
});

describe('usage and terminal display', () => {
  it.each([50, 80, 120])('keeps the approval readable at %i columns', async (width) => {
    const input = props();
    void input.approvals.broker.request(request);
    const screen = render(<App {...input} />);
    Object.defineProperty(screen.stdout, 'columns', { value: width });
    await tick(); screen.stdout.emit('resize'); await tick();
    const frame = screen.lastFrame() ?? '';
    expect(frame).toContain('deny');
    expect(frame.split('\n').every((line) => displayWidth(line) <= width)).toBe(true);
    input.approvals.denyAll();
  });
  it.each(['truecolor', '256', '16', 'none'] satisfies ColorDepth[])('renders with %s theme', (depth) => {
    const input = props();
    const theme = createTheme({ env: {}, isTTY: true }, { depth, reducedMotion: true });
    const screen = render(<App {...input} theme={theme} />);
    expect(screen.lastFrame()).toContain('lightweight OpenClaw');
    expect(screen.lastFrame()).toContain('runtime  ready');
  });
  it('shows partial usage snapshots without double-counting the completed turn', () => {
    const usage = { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4 };
    let state = chatReducer(initialChatState, { type: 'engine', at: 0, event: { type: 'usage.updated', usage, costUsd: null, completeness: 'partial' } });
    expect(state.turnUsage).toEqual(usage);
    state = chatReducer(state, { type: 'engine', at: 1, event: { type: 'turn.completed', usage, costUsd: 0.01, durationMs: 1 } });
    expect(state.totals).toEqual(usage);
    expect(state.turnUsage).toBeNull();
  });
  it('renders readable ASCII with no color escapes and genuine detection failure', () => {
    const input = props();
    const screen = render(<App {...input} detection={{ engineId: 'claude', ready: false, executablePath: null, version: null,
      steps: [{ level: 'L1-locate', ok: false, detail: 'Claude missing', tried: ['/fixture/bin/claude'] }], fix: 'claude auth login' }} />);
    expect(screen.lastFrame()).toContain('Claude missing');
    expect(screen.lastFrame()).toContain('tried: /fixture/bin/claude');
    expect(screen.lastFrame()).toContain('fix: claude auth login');
    expect(screen.lastFrame()).not.toMatch(/\x1b\[(?:3[0-9]|4[0-9]|9[0-7]|38;|48;)/);
    expect(screen.lastFrame()).not.toMatch(/[^\x00-\x7f]/);
  });
});
