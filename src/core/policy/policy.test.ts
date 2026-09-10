import { describe, expect, it, vi } from 'vitest';
import { decide } from './decide.js';
import { createToolGate } from './gate.js';
import type { ToolRequest } from '../tool-gate.js';
import type { ChatEvent } from '../events.js';

const context = { homeDir: '/home/me', miniclawHome: '/home/me/.miniclaw', workspaceDir: '/tmp/work' };
const request = (tool: string, input: Record<string, unknown>): ToolRequest => ({ tool, input, toolUseId: 'one' });

describe('v0.1 hard floor', () => {
  it.each(['~/.ssh/key', '$HOME/.aws/config', '/home/me/.gnupg/x',
    '/home/me/Library/Keychains/x', '.env', '.envrc', '.env.production',
    '/home/me/.miniclaw/users/me/policy.json', '.env-secrets/nested'])('denies %s', file => {
    expect(decide(request('Read', { file_path: file }), context).verdict).toBe('deny');
  });
  it.each(['rm file', 'rm -rf /tmp/other', 'find . -delete', 'python -c "print(1)"',
    'node script.js', 'eval echo', 'cat $(echo secret)', 'cat *', 'security find-generic-password',
    'cat ~/.ssh/key', 'cp -R ~ backup'])('rejects deletion or opaque shell: %s', command => {
    const result = decide(request('Bash', { command }), context);
    if (command === 'cp -R ~ backup') expect(result.verdict).toBe('ask');
    else expect(result.verdict).toBe('deny');
  });
  it('allows normal reads, asks for writes and simple shell', () => {
    expect(decide(request('Read', { file_path: 'note.txt' }), context).verdict).toBe('allow');
    expect(decide(request('Write', { file_path: 'out.txt' }), context).verdict).toBe('ask');
    expect(decide(request('Bash', { command: 'echo hello' }), context).verdict).toBe('ask');
  });
  it('does not let home workspace unlock miniclaw state', () => {
    expect(decide(request('Read', { file_path: '~/.miniclaw/policy.json' }),
      { ...context, workspaceDir: context.homeDir }).verdict).toBe('deny');
  });
});

describe('tool gate', () => {
  it('audits every repeat, scopes grants to exact input, checks inspector again', async () => {
    const events: ChatEvent[] = [];
    const approve = vi.fn().mockResolvedValue('session');
    const inspect = vi.fn().mockResolvedValue(null);
    const gate = createToolGate({ context, approvals: { request: approve }, inspect,
      events: { write: event => events.push(event) } });
    const first = request('Write', { file_path: 'one' });
    expect((await gate.check(first)).allowed).toBe(true);
    expect((await gate.check(first)).allowed).toBe(true);
    expect(approve).toHaveBeenCalledTimes(1);
    await gate.check(request('Write', { file_path: 'two' }));
    expect(approve).toHaveBeenCalledTimes(2);
    inspect.mockResolvedValue({ verdict: 'deny', reason: 'symlink moved', ruleId: 'canonical' });
    expect((await gate.check(first)).allowed).toBe(false);
    expect(inspect).toHaveBeenCalledTimes(4);
    expect(events).toHaveLength(4);
  });
  it('cancels even if the approval broker never resolves', async () => {
    const controller = new AbortController();
    const gate = createToolGate({ context, approvals: { request: () => new Promise(() => {}) },
      inspect: async () => null, events: { write: () => {} } });
    const pending = gate.check(request('Write', { file_path: 'one' }), controller.signal);
    controller.abort();
    expect((await pending).allowed).toBe(false);
  });
  it('cannot execute when audit persistence fails', async () => {
    const gate = createToolGate({ context, approvals: { request: async () => 'once' },
      inspect: async () => null, events: { write: () => { throw new Error('disk full'); } } });
    await expect(gate.check(request('Read', { file_path: 'one' }))).rejects.toThrow('disk full');
  });
});
