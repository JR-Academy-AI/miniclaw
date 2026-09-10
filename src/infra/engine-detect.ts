import { access, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { homedir } from 'node:os';
import type { DetectionReport, DetectionStep } from '../core/engine-detection.js';

export interface DetectionOptions { readonly executablePath?: string }
interface Probe { code: number; stdout: string; stderr: string; failure: string }
interface EngineProbe {
  id: 'codex' | 'claude'; label: string; authArgs: string[]; login: string;
  authenticated: (probe: Probe) => boolean;
}
const CLAUDE: EngineProbe = { id: 'claude', label: 'Claude', authArgs: ['auth', 'status', '--json'],
  login: 'claude auth login', authenticated: result => {
    try { return result.code === 0 && JSON.parse(result.stdout).loggedIn === true; }
    catch { return false; }
  } };
const CODEX: EngineProbe = { id: 'codex', label: 'Codex', authArgs: ['login', 'status'], login: 'codex login',
  authenticated: result => result.code === 0 && /Logged in using (?:ChatGPT|an API key|API key)/i.test(result.stdout + result.stderr) };

export const detectClaudeEngine = (options: DetectionOptions = {}): Promise<DetectionReport> => detect(CLAUDE, options);
export const detectCodexEngine = (options: DetectionOptions = {}): Promise<DetectionReport> => detect(CODEX, options);

async function detect(engine: EngineProbe, options: DetectionOptions): Promise<DetectionReport> {
  const candidates = options.executablePath ? [path.resolve(options.executablePath)] : defaultCandidates(engine.id);
  const executable = await locate(candidates);
  const steps: DetectionStep[] = [{ level: 'L1-locate', ok: executable !== null,
    detail: executable ?? `${engine.label} was not found.`, tried: candidates }];
  const result = (version: string | null, fix: string | null): DetectionReport => ({
    engineId: engine.id, ready: steps.length === 3 && steps.every(step => step.ok),
    steps, executablePath: executable, version, fix });
  if (!executable) return result(null, `Install ${engine.label}, then run ${engine.login}.`);
  const versionProbe = await probe(executable, ['--version']);
  const version = versionProbe.stdout.match(/\b\d+\.\d+\.\d+\b/)?.[0] ?? null;
  steps.push({ level: 'L2-executable', ok: versionProbe.code === 0 && version !== null,
    detail: versionProbe.code === 0 && version ? `${engine.label} ${version}` :
      `Version check failed: ${versionProbe.failure || 'no recognizable version'}.`, tried: [`${executable} --version`] });
  if (!steps[1]?.ok) return result(version, `Check this executable or choose --${engine.id}-path.`);
  const authentication = await probe(executable, engine.authArgs);
  const loggedIn = engine.authenticated(authentication);
  steps.push({ level: 'L3-logged-in', ok: loggedIn,
    detail: loggedIn ? `${engine.label} reports an existing login; no billable model request was made.` :
      `${engine.label} did not confirm a login${authentication.failure ? ` (${authentication.failure})` : ''}.`,
    tried: [`${executable} ${engine.authArgs.join(' ')} (selected status only)`] });
  return result(version, loggedIn ? null : `Run ${engine.login}, then restart miniclaw.`);
}

function defaultCandidates(engine: string): string[] {
  const folders = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  const legacy = engine === 'claude' ? [path.join(homedir(), '.claude/local/claude')] : [];
  return [...new Set([...folders.map(folder => path.join(folder, engine)),
    path.join(homedir(), `.local/bin/${engine}`), `/opt/homebrew/bin/${engine}`,
    `/usr/local/bin/${engine}`, ...legacy])];
}

async function locate(candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    try { await access(candidate, constants.X_OK); return await realpath(candidate); }
    catch (error) {
      if (!['ENOENT', 'EACCES', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
    }
  }
  return null;
}

function probe(executable: string, args: string[]): Promise<Probe> {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of ['HOME', 'PATH', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'LANG']) {
    if (process.env[key]) environment[key] = process.env[key];
  }
  return new Promise(resolve => {
    execFile(executable, args, { env: environment, timeout: 10000, maxBuffer: 65536 }, (error, stdout, stderr) =>
      resolve({ code: error ? 1 : 0, stdout, stderr, failure: error ?
        `exit ${String(error.code ?? 'unknown')}${error.signal ? `, signal ${error.signal}` : ''}` : '' }));
  });
}
