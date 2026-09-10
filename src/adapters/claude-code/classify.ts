// Raw Claude Code failure → EngineError (GATEWAY §6.3, appendix A.1). Pure.
// When a failure is ambiguous it is classified toward "do not retry"; unrecognised → UNKNOWN.
import { ORG_POLICY_LIMIT_PREFIXES, USAGE_LIMIT_ERROR_PREFIXES } from '@anthropic-ai/claude-agent-sdk';
import type { EngineError, ErrorKind } from '../../core/errors.js';
import { oneLine } from './read.js';

/** Latest subscription rate-limit snapshot from a `rate_limit_event` message. */
export interface RateLimitSnapshot {
  readonly status: string;
  /** Unix seconds. */
  readonly resetsAt: number | null;
}

export interface EngineFailure {
  /** `error` on the engine's synthetic assistant message, e.g. "authentication_failed". */
  readonly errorCode: string | null;
  /** HTTP status, from `api_error_status` on the result. */
  readonly status: number | null;
  /** Engine text: the result text, `errors[]`, or a thrown error's message. */
  readonly text: string;
  readonly rateLimit: RateLimitSnapshot | null;
}

interface Rule {
  readonly kind: ErrorKind;
  readonly matches: (failure: EngineFailure) => boolean;
  readonly hint: string;
}

const AUTH_CODES = new Set(['authentication_failed', 'oauth_org_not_allowed', 'account_on_hold', 'cloud_credential_error']);
const OVERLOAD_CODES = new Set(['overloaded', 'server_error']);
const CONFIG_CODES = new Set(['model_not_found', 'invalid_request']);
const QUOTA_TEXT = /credit balance is too low|enforced_spend_limit|reached your specified API usage limits|usage limit|spend limit/i;
const AUTH_TEXT = /failed to authenticate|invalid api key|not logged in|please run \/login|oauth token (has )?expired/i;
const NETWORK_TEXT = /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|EAI_AGAIN|socket hang up|fetch failed|connection error|network error/i;
const EXECUTABLE_MISSING = /ENOENT|executable not found|no such file/i;

const LOGIN_HINT = 'Run `claude` in a terminal and use /login, then try again.';

function isRateLimit(failure: EngineFailure): boolean {
  return failure.errorCode === 'rate_limit' || failure.status === 429;
}

function isUsageLimit(failure: EngineFailure): boolean {
  if (USAGE_LIMIT_ERROR_PREFIXES.some((prefix) => failure.text.includes(prefix))) return true;
  if (failure.errorCode === 'billing_error' || failure.status === 402) return true;
  // A 429 while the subscription window reports "rejected" is a plan limit, not a burst limit.
  if (isRateLimit(failure) && failure.rateLimit?.status === 'rejected') return true;
  return QUOTA_TEXT.test(failure.text);
}

const RULES: readonly Rule[] = [
  {
    kind: 'AUTH',
    matches: (failure) => ORG_POLICY_LIMIT_PREFIXES.some((prefix) => failure.text.includes(prefix)),
    hint: 'Your organization has disabled this service. Contact your Claude organization admin.',
  },
  { kind: 'QUOTA_EXHAUSTED', matches: isUsageLimit, hint: 'Wait for your usage limit to reset, or check your plan with /usage in `claude`.' },
  {
    kind: 'AUTH',
    matches: (failure) =>
      AUTH_CODES.has(failure.errorCode ?? '') || failure.status === 401 || failure.status === 403 || AUTH_TEXT.test(failure.text),
    hint: LOGIN_HINT,
  },
  {
    kind: 'INVALID_CONFIG',
    matches: (failure) => failure.errorCode === 'model_not_found' || failure.status === 404,
    hint: 'Check the model name. Run `claude` and use /model to see the models your account can use.',
  },
  {
    kind: 'INVALID_CONFIG',
    matches: (failure) => CONFIG_CODES.has(failure.errorCode ?? '') || failure.status === 400,
    hint: 'The request was rejected as invalid. Start a new chat with /clear and try again.',
  },
  { kind: 'RATE_LIMITED', matches: isRateLimit, hint: 'Too many requests right now. Wait a minute and try again.' },
  {
    kind: 'OVERLOADED',
    matches: (failure) => OVERLOAD_CODES.has(failure.errorCode ?? '') || (failure.status !== null && failure.status >= 500),
    hint: 'Claude is overloaded right now. Try again in a few minutes.',
  },
  {
    kind: 'NETWORK',
    matches: (failure) => NETWORK_TEXT.test(failure.text),
    hint: 'Check your internet connection or proxy settings (HTTPS_PROXY), then try again.',
  },
];

const UNKNOWN_HINT = 'Try again. If it keeps happening, check the transcript log for the full error.';

/** Masks anything that looks like an Anthropic key or bearer token before it reaches logs or the UI. */
function redact(text: string): string {
  return text.replace(/sk-ant-[A-Za-z0-9_-]+/g, 'sk-ant-***').replace(/Bearer\s+\S+/gi, 'Bearer ***');
}

function describe(failure: EngineFailure, kind: ErrorKind): string {
  const text = oneLine(redact(failure.text), 300);
  if (text !== '') return text;
  return kind === 'UNKNOWN' ? 'Claude Code failed without an error message.' : `Claude Code reported ${kind}.`;
}

function resetAt(failure: EngineFailure, kind: ErrorKind): string | undefined {
  const seconds = failure.rateLimit?.resetsAt;
  if (kind !== 'QUOTA_EXHAUSTED' || seconds === null || seconds === undefined) return undefined;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function classifyFailure(failure: EngineFailure): EngineError {
  const rule = RULES.find((candidate) => candidate.matches(failure));
  const kind = rule?.kind ?? 'UNKNOWN';
  const message = describe(failure, kind);
  const reset = resetAt(failure, kind);
  const base = { kind, message, hint: rule?.hint ?? UNKNOWN_HINT };
  return reset === undefined ? base : { ...base, resetAt: reset };
}

/** An exception from the SDK (spawn failure, process exit) rather than an error result. */
export function classifyThrown(error: unknown, stderrTail: string): EngineError {
  const message = error instanceof Error ? error.message : String(error);
  const text = stderrTail === '' ? message : `${message} ${stderrTail}`;
  if (EXECUTABLE_MISSING.test(message)) {
    return {
      kind: 'INVALID_CONFIG',
      message: oneLine(redact(message), 300),
      hint: 'Claude Code could not be started. Install it, or fix the configured executable path.',
    };
  }
  return classifyFailure({ errorCode: null, status: null, text, rateLimit: null });
}
