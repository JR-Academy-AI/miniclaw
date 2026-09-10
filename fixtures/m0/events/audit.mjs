// Offline evidence audit only; this is not the production usage normalizer.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const names = ['stream-multiturn', 'thinking', 'gate', 'interrupt',
  'interrupt-hook', 'auth-invalid-key', 'bad-model'];
const fields = ['input_tokens', 'cache_creation_input_tokens',
  'cache_read_input_tokens', 'output_tokens'];
const sourceRoot = new URL('../../claude-code/', import.meta.url);
const zero = () => Object.fromEntries(fields.map((key) => [key, 0]));
const selectUsage = (usage) => Object.fromEntries(fields.map((key) => [key, usage?.[key] ?? null]));
const sum = (usages) => usages.reduce((total, usage) => {
  for (const key of fields) total[key] += usage?.[key] ?? 0;
  return total;
}, zero());

export function readFixture(name) {
  const raw = readFileSync(new URL(`${name}.jsonl`, sourceRoot), 'utf8');
  return { raw, events: raw.trim().split('\n').map((line) => JSON.parse(line)) };
}

function streamRequests(events) {
  const requests = new Map();
  let activeId;
  for (const { event, parent_tool_use_id: parent } of events) {
    if (!event) continue;
    if (parent) throw new Error('Subagent streams require per-parent active IDs; this audit covers root only.');
    if (event.type === 'message_start') {
      activeId = event.message.id;
      requests.set(activeId, { usage: selectUsage(event.message.usage), finalized: false });
    }
    if (event.type === 'message_delta' && event.usage) {
      if (!activeId) throw new Error('Usage delta without a message_start');
      const previous = requests.get(activeId);
      requests.set(activeId, { usage: { ...previous.usage, ...event.usage }, finalized: true });
    }
    if (event.type === 'message_stop') activeId = undefined;
  }
  return [...requests].map(([id, value]) => ({ id, ...value, usage: selectUsage(value.usage) }));
}

function results(events) {
  let previousCost = 0;
  return events.flatMap((event, index) => {
    if (event.type !== 'result') return [];
    const costDelta = event.total_cost_usd - previousCost;
    previousCost = event.total_cost_usd;
    return [{ line: index + 1, sessionId: event.session_id, subtype: event.subtype,
      isError: event.is_error, terminalReason: event.terminal_reason,
      usage: selectUsage(event.usage), cumulativeEstimatedUsd: event.total_cost_usd,
      estimatedUsdDelta: Number(costDelta.toFixed(10)),
      modelUsage: event.modelUsage, numTurns: event.num_turns,
      text: event.result ?? null }];
  });
}

export function auditFixture(name) {
  const { raw, events } = readFixture(name);
  const assistant = events.filter((event) => event.type === 'assistant');
  const unique = [...new Map(assistant.map((event) => [event.message.id, event.message.usage])).values()];
  const requests = streamRequests(events);
  const deltas = events.filter((event) => event.event?.type === 'content_block_delta');
  return { source: `fixtures/claude-code/${name}.jsonl`, evidenceKind: 'existing-real-sdk-capture',
    sha256: createHash('sha256').update(raw).digest('hex'), lines: events.length,
    assistantEvents: assistant.length, uniqueAssistantIds: unique.length,
    naiveAssistantUsage: sum(assistant.map((event) => event.message.usage)),
    deduplicatedAssistantSnapshotUsage: sum(unique),
    streamUsage: sum(requests.map((request) => request.usage)), requests,
    textDeltaCount: deltas.filter((event) => event.event.delta.type === 'text_delta').length,
    thinkingDeltaCount: deltas.filter((event) => event.event.delta.type === 'thinking_delta').length,
    nonemptyThinkingDeltaCount: deltas.filter((event) => Boolean(event.event.delta.thinking)).length,
    toolCalls: assistant.flatMap((event) => event.message.content.filter((block) => block.type === 'tool_use')),
    rateLimitStatuses: events.filter((event) => event.type === 'rate_limit_event')
      .map((event) => event.rate_limit_info.status),
    assistantErrors: assistant.filter((event) => event.error).map((event) => ({
      error: event.error, isApiError: event.is_api_error_message,
      text: event.message.content.filter((block) => block.type === 'text').map((block) => block.text).join(''),
    })), results: results(events) };
}

export function auditAll() {
  return { scope: 'M0 offline verification; no SDK calls and no billing verification',
    sourceGenerator: 'fixtures/claude-code/spike/spike.mjs',
    missingRealErrorEvidence: ['UNAUTHENTICATED_NO_CREDENTIALS', 'QUOTA_EXHAUSTED', 'RATE_LIMITED', 'OVERLOADED'],
    fixtures: Object.fromEntries(names.map((name) => [name, auditFixture(name)])) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const report = auditAll();
  writeFileSync(new URL('normalized-evidence.json', import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Audited ${names.length} existing fixtures; wrote normalized-evidence.json; no network calls.`);
}
