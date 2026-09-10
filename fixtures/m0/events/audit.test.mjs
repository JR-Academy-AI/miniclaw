import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { auditAll } from './audit.mjs';

const actual = auditAll();
const fixtures = actual.fixtures;

test('archived normalized evidence still matches exact source captures', () => {
  const expected = JSON.parse(readFileSync(new URL('normalized-evidence.json', import.meta.url)));
  assert.deepEqual(actual, expected);
});

test('two prompts retain one session and stream real text', () => {
  const stream = fixtures['stream-multiturn'];
  assert.deepEqual(stream.results.map((result) => result.text), ['pong', 'pong']);
  assert.equal(new Set(stream.results.map((result) => result.sessionId)).size, 1);
  assert.ok(stream.textDeltaCount > 0);
});

test('thinking exists but default events can contain no visible thinking text', () => {
  assert.ok(fixtures.thinking.nonemptyThinkingDeltaCount > 0);
  assert.ok(fixtures['stream-multiturn'].thinkingDeltaCount > 0);
  assert.equal(fixtures['stream-multiturn'].nonemptyThinkingDeltaCount, 0);
});

test('tools and duplicate assistant IDs require snapshot replacement, not summing', () => {
  assert.deepEqual(fixtures.gate.toolCalls.map((tool) => tool.name), ['Bash', 'Bash', 'Read', 'Write']);
  const stream = fixtures['stream-multiturn'];
  assert.equal(stream.assistantEvents, 4);
  assert.equal(stream.uniqueAssistantIds, 2);
  assert.equal(stream.deduplicatedAssistantSnapshotUsage.output_tokens, 8);
  assert.equal(stream.streamUsage.output_tokens, 89);
  assert.deepEqual(stream.requests.map((request) => request.usage.output_tokens), [45, 44]);
});

test('turn usage is incremental while cost and modelUsage are session cumulative', () => {
  const turns = fixtures['stream-multiturn'].results;
  assert.deepEqual(turns.map((turn) => turn.usage.output_tokens), [45, 44]);
  assert.equal(turns[0].cumulativeEstimatedUsd, 0.03648);
  assert.equal(turns[1].cumulativeEstimatedUsd, 0.0386745);
  assert.equal(turns[1].estimatedUsdDelta, 0.0021945);
  const model = Object.values(turns[1].modelUsage)[0];
  assert.equal(model.outputTokens, 100); // Includes usage absent from foreground stream (89).
});

test('both interrupt forms terminate and the same query accepts another prompt', () => {
  for (const name of ['interrupt', 'interrupt-hook']) {
    const turns = fixtures[name].results;
    assert.equal(turns[0].isError, true);
    assert.match(turns[0].terminalReason, /^aborted_/);
    assert.equal(turns[1].text, 'still-alive');
    assert.equal(turns[1].isError, false);
    assert.equal(turns[0].sessionId, turns[1].sessionId);
  }
});

test('aborted output has an all-zero result usage despite nonzero stream snapshot', () => {
  const interrupted = fixtures.interrupt;
  assert.equal(Object.values(interrupted.results[0].usage).reduce((a, b) => a + b), 0);
  assert.ok(interrupted.requests[0].usage.output_tokens > 0);
  assert.equal(interrupted.requests[0].finalized, false);
});

test('an SDK success subtype can still be AUTH failure', () => {
  const auth = fixtures['auth-invalid-key'];
  assert.equal(auth.results[0].subtype, 'success');
  assert.equal(auth.results[0].isError, true);
  assert.equal(auth.assistantErrors[0].error, 'authentication_failed');
  assert.match(auth.assistantErrors[0].text, /401 API key is invalid/);
});

test('allowed and allowed_warning telemetry does not establish quota/rate failure', () => {
  assert.deepEqual(fixtures['stream-multiturn'].rateLimitStatuses, ['allowed']);
  assert.ok(fixtures.thinking.rateLimitStatuses.includes('allowed_warning'));
  assert.equal(fixtures.thinking.results[0].isError, false);
  assert.ok(actual.missingRealErrorEvidence.includes('QUOTA_EXHAUSTED'));
});
