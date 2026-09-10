import { expect, it } from 'vitest';
import { parseArguments } from './arguments.js';
import { selectEngine } from './engines.js';

it('uses only the selected engine environment path; explicit CLI path wins', () => {
  const environment = { MINICLAW_CODEX_PATH: '/codex', MINICLAW_CLAUDE_PATH: '/claude' };
  expect(selectEngine(parseArguments([]), environment).executablePath).toBe('/codex');
  expect(selectEngine(parseArguments(['--engine', 'claude']), environment).executablePath).toBe('/claude');
  expect(selectEngine(parseArguments(['--codex-path', '/pinned']), environment).executablePath).toBe('/pinned');
  expect(selectEngine(parseArguments([]), { MINICLAW_CLAUDE_PATH: '/claude' }).executablePath).toBeUndefined();
});

it('detects only the selected engine without loading either adapter', async () => {
  const codex = selectEngine(parseArguments(['--codex-path', '/miniclaw-test-does-not-exist']));
  const report = await codex.detect({ executablePath: codex.executablePath });
  expect(report.engineId).toBe('codex');
  expect(report.ready).toBe(false);
  expect(report.steps[0]?.tried).toEqual(['/miniclaw-test-does-not-exist']);
});
