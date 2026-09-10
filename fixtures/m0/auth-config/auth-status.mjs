import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Only the engine reads its own credential store. Never inspect or copy credentials.
const env = {};
for (const key of ['HOME', 'PATH', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'LANG']) {
  if (process.env[key]) env[key] = process.env[key];
}
const isolated = mkdtempSync(join(tmpdir(), 'miniclaw-m0-auth-'));
const cases = [['existing-login', env], ['isolated-config-dir', { ...env, CLAUDE_CONFIG_DIR: isolated }]];
const observations = cases.map(([name, environment]) => {
  const result = spawnSync('claude', ['auth', 'status', '--json'], { env: environment, encoding: 'utf8', timeout: 10000 });
  let status;
  try { status = JSON.parse(result.stdout); } catch { status = {}; }
  return { name, exitCode: result.status, signal: result.signal,
    errorCode: result.error?.code, loggedIn: status.loggedIn,
    authMethod: status.authMethod, apiProvider: status.apiProvider,
    subscriptionType: status.subscriptionType,
    stderrPresent: Boolean(result.stderr?.trim()) };
});
const evidence = { timestamp: new Date().toISOString(), observations };
writeFileSync(join(dirname(fileURLToPath(import.meta.url)), 'auth-status.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence));
