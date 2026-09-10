import type { ApprovalBroker, ApprovalChoice } from '../approval.js';
import type { EventSink } from '../events.js';
import type { GateResult, ToolGate, ToolRequest } from '../tool-gate.js';
import type { Decision, PolicyContext } from './types.js';
import { decide } from './decide.js';

export interface ToolGateOptions {
  readonly context: PolicyContext;
  readonly approvals: ApprovalBroker;
  readonly events: EventSink;
  readonly inspect: (request: ToolRequest) => Promise<Decision | null>;
}

export function createToolGate(options: ToolGateOptions): ToolGate {
  const grants = new Set<string>();
  return { check: async (request, signal) => {
    let decision = decide(request, options.context);
    if (decision.verdict !== 'deny') decision = await options.inspect(request) ?? decision;
    if (signal?.aborted) decision = { verdict: 'deny', ruleId: 'cancelled', reason: 'The action was cancelled.' };
    const key = JSON.stringify([request.tool, request.input]);
    if (decision.verdict !== 'ask') return record(options, request, { ...decision, verdict: decision.verdict, resolvedBy: 'rule' });
    const choice = grants.has(key) ? 'session' : await ask(options.approvals, request, { decision, signal });
    const approved = (choice === 'once' || choice === 'session') && !signal?.aborted;
    if (approved && choice === 'session') grants.add(key);
    return record(options, request, { verdict: approved ? 'allow' : 'deny',
      ruleId: approved ? 'approval.granted' : 'approval.denied',
      reason: approved ? `Approved for ${choice === 'session' ? 'this exact action in this session' : 'one call'}.` : 'Approval denied or cancelled.',
      resolvedBy: 'user' });
  } };
}

interface AskOptions { decision: Decision; signal: AbortSignal | undefined }
async function ask(broker: ApprovalBroker, request: ToolRequest, options: AskOptions): Promise<ApprovalChoice> {
  if (options.signal?.aborted) return 'deny';
  return new Promise((resolve, reject) => {
    const abort = () => resolve('deny');
    options.signal?.addEventListener('abort', abort, { once: true });
    const input = { toolUseId: request.toolUseId, tool: request.tool,
      summary: approvalSummary(request), reason: options.decision.reason };
    broker.request(input, options.signal).then(resolve, reject).finally(() =>
      options.signal?.removeEventListener('abort', abort));
  });
}

function approvalSummary(request: ToolRequest): string {
  const input = request.input;
  const value = input.command ?? input.file_path ?? input.notebook_path ?? input.url ?? input.query;
  const detail = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  const clipped = detail.length > 140 ? `${detail.slice(0, 137)}...` : detail;
  return clipped ? `${request.tool}: ${clipped}` : `${request.tool} with ${Object.keys(input).length} input field(s)`;
}

type ResolvedDecision = Omit<Decision, 'verdict'> & { verdict: 'allow' | 'deny'; resolvedBy: 'rule' | 'user' };
function record(options: ToolGateOptions, request: ToolRequest, decision: ResolvedDecision): GateResult {
  options.events.write({ type: 'policy.decided', toolUseId: request.toolUseId,
    tool: request.tool, ...decision });
  return { allowed: decision.verdict === 'allow', reason: decision.reason };
}
