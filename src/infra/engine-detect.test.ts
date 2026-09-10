import { afterEach, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { detectCodexEngine, detectClaudeEngine } from './engine-detect.js';

const roots: string[] = [];
async function executable(status: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'miniclaw-detection-test-'));
  roots.push(root);
  const file = path.join(root, 'engine');
  await writeFile(file, '#!/bin/sh\nif [ "$1" = "--version" ]; then echo engine-1.2.3; exit 0; fi\n' + status + '\n', { mode: 0o700 });
  return file;
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

it('recognizes Codex status on stderr without publishing account or key text', async () => {
  const file = await executable('echo "Logged in using ChatGPT" >&2\necho "synthetic-private-marker" >&2');
  const report = await detectCodexEngine({ executablePath: file });
  expect(report.ready).toBe(true);
  expect(report.engineId).toBe('codex');
  expect(report.version).toBe('1.2.3');
  expect(JSON.stringify(report)).not.toContain('synthetic-private-marker');
});
it('rejects ambiguous or failed Codex login results', async () => {
  for (const status of ['echo "Not logged in"', 'echo "Logged in using ChatGPT" >&2\nexit 1']) {
    const report = await detectCodexEngine({ executablePath: await executable(status) });
    expect(report.ready).toBe(false);
    expect(report.fix).toContain('codex login');
  }
});
it('keeps Claude JSON login validation and engine-specific identity', async () => {
  const file = await executable('echo \'{"loggedIn":true,"email":"synthetic-private-marker"}\'');
  const report = await detectClaudeEngine({ executablePath: file });
  expect(report.ready).toBe(true);
  expect(report.engineId).toBe('claude');
  expect(JSON.stringify(report)).not.toContain('synthetic-private-marker');
});
