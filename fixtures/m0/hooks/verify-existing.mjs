import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const source = new URL('../../claude-code/', import.meta.url);
const snapshots = [];
function read(name) {
  const bytes = readFileSync(new URL(name, source));
  snapshots.push({ file: `fixtures/claude-code/${name}`, bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex') });
  if (name.endsWith('.mjs')) return bytes.toString();
  return name.endsWith('.jsonl') ? bytes.toString().trim().split('\n').map(JSON.parse)
    : JSON.parse(bytes.toString());
}
function blocks(messages, type) {
  return messages.flatMap(message => Array.isArray(message.message?.content)
    ? message.message.content.filter(block => block.type === type) : []);
}

read('spike/spike.mjs');
const gate = read('gate.jsonl');
const calls = read('gate-calls.json');
const uses = blocks(gate, 'tool_use');
const results = blocks(gate, 'tool_result');
assert.equal(uses.length, 4);
for (const use of uses) {
  assert.equal(calls.filter(call => call.at === 'hook' && call.toolUseId === use.id).length, 1);
  assert.equal(results.filter(result => result.tool_use_id === use.id).length, 1);
}
const hookCalls = calls.filter(call => call.at === 'hook');
const askCalls = calls.filter(call => call.at === 'canUseTool');
assert.deepEqual(hookCalls.map(call => call.verdict), ['deny', 'allow', 'ask', 'ask']);
assert.deepEqual(askCalls.map(call => [call.tool, call.allow]), [['Read', true], ['Write', false]]);
assert.deepEqual(results.map(result => Boolean(result.is_error)), [true, false, false, true]);
assert.equal(results[1].content, 'step2');
assert.match(results[2].content, /the secret word is walrus/);
assert.match(results[3].content, /spike canUseTool deny/);

const timeout = read('hook-timeout-3-8000.jsonl');
const timeoutResult = blocks(timeout, 'tool_result');
assert.equal(timeoutResult.length, 1);
assert.equal(timeoutResult[0].is_error, true);
assert.match(timeoutResult[0].content, /tool call was not executed/);
const waited = read('ask-wait-75000.jsonl');
assert.equal(blocks(waited, 'tool_result')[0].content, 'asked');
assert.ok(waited.find(message => message.type === 'result').duration_ms >= 75000);
const defaultTimeout = read('hook-timeout-default-75000.jsonl');
assert.equal(blocks(defaultTimeout, 'tool_result')[0].content, 'slow-hook');
assert.ok(defaultTimeout.find(message => message.type === 'result').duration_ms >= 75000);
const interrupted = read('interrupt-hook.jsonl');
assert.equal(blocks(interrupted, 'tool_result')[0].is_error, true);
assert.equal(interrupted.find(message => message.tool_result_meta)?.tool_result_meta[0].non_execution_kind,
  'user-rejected');
const interruptResults = interrupted.filter(message => message.type === 'result');
assert.equal(interruptResults[0].terminal_reason, 'aborted_tools');
assert.equal(interruptResults[1].result, 'still-alive');
const summary = { verifiedAt: new Date().toISOString(), source: 'existing real SDK fixture replay',
  engineVersion: gate.find(message => message.subtype === 'init').claude_code_version,
  assertions: ['four tool calls each have exactly one hook and result',
    'hook deny prevents Bash; hook allow executes Bash', 'hook ask reaches canUseTool for Read and Write',
    'canUseTool allows Read and denies Write', 'explicit hook timeout prevents execution',
    '75-second approval and hook waits complete', 'pending hook interruption rejects tool; next turn succeeds'],
  snapshots };
writeFileSync(new URL('evidence/existing-verification.json', import.meta.url), JSON.stringify(summary, null, 2) + '\n');
console.log(`PASS: ${summary.assertions.length} evidence checks (${fileURLToPath(source)})`);
