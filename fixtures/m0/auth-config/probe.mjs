import { query } from '@anthropic-ai/claude-agent-sdk';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const output = dirname(fileURLToPath(import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'miniclaw-m0-config-'));
const home = join(root, 'home');
const config = join(home, '.claude');
const cwd = join(root, 'workspace');
for (const directory of [config, join(cwd, '.claude'), join(config, 'skills/canary')]) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
}
const canary = join(root, 'canary.mjs');
writeFileSync(canary, `import {appendFileSync} from 'node:fs';
appendFileSync(process.argv[2], JSON.stringify({ source: process.argv[3], value: process.env.MINICLAW_M0_CANARY }) + '\\n');
`);
const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
const command = (marker, source) => [process.execPath, canary, marker, source].map(quote).join(' ');
const marker = join(root, 'markers.jsonl');
const settings = (source) => ({
  env: { MINICLAW_M0_CANARY: source },
  permissions: { allow: ['Bash(*)'] },
  hooks: { SessionStart: [{ hooks: [{ type: 'command', command: command(marker, source) }] }] },
});
writeFileSync(join(config, 'settings.json'), JSON.stringify(settings('user')));
writeFileSync(join(cwd, '.claude/settings.json'), JSON.stringify(settings('project')));
writeFileSync(join(cwd, '.claude/settings.local.json'), JSON.stringify(settings('local')));
writeFileSync(join(config, 'skills/canary/SKILL.md'), '---\nname: m0-canary\ndescription: Synthetic isolation canary\n---\nReply CANARY.\n');
writeFileSync(join(cwd, '.mcp.json'), JSON.stringify({ mcpServers: {
  'm0-canary': { command: process.execPath, args: [canary, marker, 'mcp'] },
} }));

function environment() {
  const env = {};
  for (const name of ['PATH', 'TMPDIR', 'LANG', 'SHELL']) if (process.env[name]) env[name] = process.env[name];
  return { ...env, HOME: home, CLAUDE_CONFIG_DIR: config,
    ANTHROPIC_API_KEY: 'm0-synthetic-not-a-credential', ANTHROPIC_BASE_URL: 'http://127.0.0.1:1',
    MINICLAW_M0_CANARY: 'process', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', CLAUDE_CODE_MAX_RETRIES: '0', API_TIMEOUT_MS: '2000' };
}

async function run(name, extra) {
  writeFileSync(marker, '');
  const events = [];
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), 20000);
  const options = { cwd, env: environment(), model: 'haiku', maxTurns: 0,
    persistSession: false, permissionMode: 'default', abortController,
    settingSources: [], strictMcpConfig: true, skills: [],
    settings: { disableBundledSkills: true }, ...extra };
  const session = query({ prompt: 'Reply OK without using tools.', options });
  try {
    for await (const event of session) {
      if (event.type === 'system' && event.subtype === 'init') events.push({
        type: 'init', tools: event.tools, skills: event.skills, mcp_servers: event.mcp_servers,
        claude_code_version: event.claude_code_version, apiKeySource: event.apiKeySource,
      });
      if (event.type === 'result') events.push({ type: 'result', subtype: event.subtype,
        is_error: event.is_error, total_cost_usd: event.total_cost_usd, num_turns: event.num_turns });
    }
  } catch (error) { events.push({ type: 'exception', name: error.name, message: error.message }); }
  finally { clearTimeout(timeout); session.close(); }
  const markers = existsSync(marker) ? readFileSync(marker, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  const result = { name, timestamp: new Date().toISOString(), events, markers };
  writeFileSync(join(output, `${name}.json`), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
}

const selected = process.argv[2] ?? 'all';
if (selected === 'all') {
  await run('isolated', {});
  await run('sources-enabled', { settingSources: ['user', 'project', 'local'], strictMcpConfig: false, skills: 'all' });
  await run('flag-env', { settings: { disableBundledSkills: true, env: { MINICLAW_M0_CANARY: 'flag' },
    hooks: { SessionStart: [{ hooks: [{ type: 'command', command: command(marker, 'flag') }] }] } } });
}
await run('explicit-tools', { tools: ['Read'], disallowedTools: ['Skill'] });
