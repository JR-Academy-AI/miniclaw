// M0 spike: drive the real Claude Agent SDK and record raw SDK messages as JSONL fixtures.
// Usage: node fixtures/claude-code/spike/spike.mjs <scenario>
// Never touches ~/.claude settings: settingSources [] + persistSession false + explicit env.
import { query } from '@anthropic-ai/claude-agent-sdk';
import { mkdtempSync, writeFileSync, appendFileSync, realpathSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..');
const MODEL = 'haiku';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const t0 = Date.now();
const log = (...args) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...args);

function baseEnv(extra = {}) {
  const pick = ['HOME', 'USER', 'LOGNAME', 'PATH', 'SHELL', 'LANG', 'TMPDIR', 'TERM'];
  const env = {};
  for (const key of pick) if (process.env[key]) env[key] = process.env[key];
  return {
    ...env,
    CLAUDE_CODE_MAX_RETRIES: '2',
    API_TIMEOUT_MS: '120000',
    CLAUDE_CODE_RETRY_WATCHDOG: '0',
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
    CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: '1',
    ...extra,
  };
}

function makeWorkspace() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'miniclaw-spike-')));
  writeFileSync(join(dir, 'note.txt'), 'the secret word is walrus\n');
  return dir;
}

function makeRecorder(name, cwd) {
  const file = join(outDir, `${name}.jsonl`);
  writeFileSync(file, '');
  const scrub = (text) => text.split(cwd).join('<cwd>').split(homedir()).join('~');
  return (message) => appendFileSync(file, scrub(JSON.stringify(message)) + '\n');
}

function createInputQueue() {
  const pending = [];
  let wake = null;
  let closed = false;
  return {
    push(text) {
      pending.push({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null });
      wake?.();
    },
    close() { closed = true; wake?.(); },
    async *[Symbol.asyncIterator]() {
      for (;;) {
        while (pending.length > 0) yield pending.shift();
        if (closed) return;
        await new Promise((resolve) => { wake = resolve; });
        wake = null;
      }
    },
  };
}

function baseOptions(cwd, extra = {}) {
  return {
    cwd,
    model: MODEL,
    settingSources: [],
    strictMcpConfig: true,
    permissionMode: 'default',
    includePartialMessages: true,
    persistSession: false,
    skills: [],
    env: baseEnv(),
    stderr: (data) => process.stderr.write(`[stderr] ${data}`),
    ...extra,
  };
}

function describe(message) {
  if (message.type === 'stream_event') {
    const e = message.event;
    if (e.type === 'content_block_delta') return `stream ${e.delta.type} ${JSON.stringify(e.delta.text ?? e.delta.thinking ?? e.delta.partial_json ?? '').slice(0, 60)}`;
    return `stream ${e.type}`;
  }
  if (message.type === 'assistant') return `assistant ${message.message.content.map((b) => b.type).join(',')} id=${message.message.id} err=${message.error ?? ''}`;
  if (message.type === 'user') return `user ${JSON.stringify(message.message.content).slice(0, 160)}`;
  if (message.type === 'result') return `result ${message.subtype} is_error=${message.is_error} cost=${message.total_cost_usd} terminal=${message.terminal_reason} result=${JSON.stringify(message.result ?? message.errors).slice(0, 200)}`;
  if (message.type === 'system') return `system ${message.subtype}`;
  return message.type;
}

/** Reads messages until (and including) the next result message. */
async function readTurn(iterator, record, onMessage) {
  for (;;) {
    const { value, done } = await iterator.next();
    if (done) { log('stream ended'); return null; }
    record(value);
    if (value.type !== 'stream_event' || value.event.type !== 'content_block_delta') log(describe(value));
    await onMessage?.(value);
    if (value.type === 'result') return value;
  }
}

async function multiTurn(name, prompts, extra = {}) {
  const cwd = makeWorkspace();
  const record = makeRecorder(name, cwd);
  const input = createInputQueue();
  const q = query({ prompt: input, options: baseOptions(cwd, extra.options) });
  const iterator = q[Symbol.asyncIterator]();
  try {
    for (const prompt of prompts) {
      log('>>> send', JSON.stringify(prompt));
      input.push(prompt);
      await readTurn(iterator, record, extra.onMessage?.(q));
    }
  } finally {
    input.close();
    q.close();
  }
}

const scenarios = {
  // Streaming + multi-turn continuity in streaming-input mode.
  stream: () => multiTurn('stream-multiturn', [
    'Reply with exactly the word: pong',
    'What single word did you reply with just now? Answer with that word only.',
  ]),

  // Thinking text is omitted by default (empty thinking_delta); the inline flag-layer setting asks for summaries.
  thinking: () => multiTurn('thinking', ['Is 391 prime? Think briefly, then answer yes or no.'], {
    options: { settings: { showThinkingSummaries: true } },
  }),

  // PreToolUse hook semantics: deny / allow / ask, and whether ask routes to canUseTool.
  gate: () => {
    const calls = [];
    const decide = (tool, input) => {
      const text = JSON.stringify(input);
      if (tool === 'Bash' && text.includes('step1')) return 'deny';
      if (tool === 'Bash' && text.includes('step2')) return 'allow';
      if (tool === 'Read') return 'ask';
      if (tool === 'Write') return 'ask';
      return 'allow';
    };
    return multiTurn('gate', [
      'Do these steps in order, one tool call at a time. If a step is denied, say so and continue with the next step.\n' +
      '1) Run the Bash command: echo step1\n2) Run the Bash command: echo step2\n3) Read the file note.txt\n4) Write the file out.txt with content x\nFinally list each step with its outcome.',
    ], {
      options: {
        hooks: { PreToolUse: [{ matcher: '.*', hooks: [async (input, toolUseId) => {
          const verdict = decide(input.tool_name, input.tool_input);
          calls.push({ at: 'hook', tool: input.tool_name, toolUseId, verdict });
          log('HOOK', input.tool_name, JSON.stringify(input.tool_input).slice(0, 80), '->', verdict);
          return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: verdict, permissionDecisionReason: `spike ${verdict}` } };
        }] }] },
        canUseTool: async (tool, input, opts) => {
          const allow = tool === 'Read';
          calls.push({ at: 'canUseTool', tool, toolUseId: opts.toolUseID, allow, decisionReason: opts.decisionReason });
          log('CANUSETOOL', tool, JSON.stringify(input).slice(0, 80), 'reason=', opts.decisionReason, '->', allow ? 'allow' : 'deny');
          return allow ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: 'spike canUseTool deny' };
        },
      },
    }).then(() => writeFileSync(join(outDir, 'gate-calls.json'), JSON.stringify(calls, null, 2)));
  },

  // Does a slow hook time out? timeoutSec undefined = engine default.
  'hook-timeout': async () => {
    const timeoutSec = process.argv[3] === 'none' ? undefined : Number(process.argv[3] ?? 3);
    const delayMs = Number(process.argv[4] ?? 8000);
    log(`hook timeout=${timeoutSec}s, hook delay=${delayMs}ms`);
    await multiTurn(`hook-timeout-${timeoutSec ?? 'default'}-${delayMs}`, [
      'Run the Bash command: echo slow-hook. Then tell me exactly what the tool returned, or the error.',
    ], {
      options: {
        hooks: { PreToolUse: [{ matcher: '.*', timeout: timeoutSec, hooks: [async (input, _id, { signal }) => {
          log('HOOK start', input.tool_name, 'waiting', delayMs);
          signal.addEventListener('abort', () => log('HOOK signal aborted'));
          await sleep(delayMs);
          log('HOOK returning allow; signal.aborted=', signal.aborted);
          return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: 'slow allow' } };
        }] }] },
        canUseTool: async (tool) => { log('CANUSETOOL (unexpected)', tool); return { behavior: 'deny', message: 'x' }; },
      },
    });
  },

  // Does canUseTool have a deadline? Hook says ask, canUseTool waits.
  'ask-wait': async () => {
    const delayMs = Number(process.argv[3] ?? 70000);
    await multiTurn(`ask-wait-${delayMs}`, [
      'Run the Bash command: echo asked. Then tell me exactly what the tool returned, or the error.',
    ], {
      options: {
        hooks: { PreToolUse: [{ matcher: '.*', hooks: [async () => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: 'needs a human' } })] }] },
        canUseTool: async (tool, input, { signal }) => {
          log('CANUSETOOL start', tool, 'waiting', delayMs);
          await sleep(delayMs);
          log('CANUSETOOL allow; aborted=', signal.aborted);
          return { behavior: 'allow', updatedInput: input };
        },
      },
    });
  },

  // Interrupt mid-stream, then check the session still answers.
  interrupt: () => {
    let interrupted = false;
    return multiTurn('interrupt', [
      'Count from 1 to 300, one number per line, no other text.',
      'Reply with exactly: still-alive',
    ], {
      onMessage: (q) => async (message) => {
        if (interrupted || message.type !== 'stream_event' || message.event.type !== 'content_block_delta') return;
        interrupted = true;
        await sleep(800);
        log('>>> interrupt()');
        const receipt = await q.interrupt();
        log('interrupt resolved', JSON.stringify(receipt));
      },
    });
  },

  // Interrupt while a PreToolUse hook is pending (e.g. an approval card is open).
  'interrupt-hook': () => {
    let fired = false;
    return multiTurn('interrupt-hook', [
      'Run the Bash command: echo pending',
      'Reply with exactly: still-alive',
    ], {
      options: {
        hooks: { PreToolUse: [{ matcher: '.*', timeout: 3600, hooks: [async (input, _id, { signal }) => {
          log('HOOK pending', input.tool_name);
          await new Promise((resolve) => {
            if (signal.aborted) return resolve();
            signal.addEventListener('abort', () => { log('HOOK signal aborted'); resolve(); });
            setTimeout(resolve, 30000);
          });
          return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'cancelled' } };
        }] }] },
      },
      onMessage: (q) => async (message) => {
        if (fired || message.type !== 'assistant' || !message.message.content.some((b) => b.type === 'tool_use')) return;
        fired = true;
        setTimeout(async () => { log('>>> interrupt()'); log('interrupt resolved', JSON.stringify(await q.interrupt())); }, 2000);
      },
    });
  },

  // Credential failure: an invalid API key only in this child's env.
  auth: () => multiTurn('auth-invalid-key', ['hi'], {
    options: { env: baseEnv({ ANTHROPIC_API_KEY: 'sk-ant-api03-invalid-spike-key-000000000000' }) },
  }),

  'bad-model': () => multiTurn('bad-model', ['hi'], { options: { model: 'claude-does-not-exist-9' } }),
};

const name = process.argv[2];
if (!scenarios[name]) {
  console.error(`usage: node spike.mjs <${Object.keys(scenarios).join('|')}>`);
  process.exit(2);
}
scenarios[name]().then(() => log('done'), (error) => { log('THREW', error?.constructor?.name, error?.message); process.exitCode = 1; });
