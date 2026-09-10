import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, symlink, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createPathInspector } from './path-inspector.js';
import { createWorkspace } from './workspace.js';
import { createTranscript } from './transcript.js';
import { detectClaudeEngine } from './engine-detect.js';

const directories: string[] = [];
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'miniclaw-infra-test-'));
  directories.push(root);
  const context = { homeDir: path.join(root, 'home'), miniclawHome: path.join(root, 'state'), workspaceDir: path.join(root, 'work') };
  await Promise.all([mkdir(context.homeDir), mkdir(context.workspaceDir), mkdir(context.miniclawHome)]);
  return { root, context };
}
afterEach(async () => { await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

describe('canonical inspector', () => {
  it('blocks existing and dangling symlink targets in protected roots', async () => {
    const { context } = await fixture();
    await mkdir(path.join(context.homeDir, '.ssh'));
    await writeFile(path.join(context.homeDir, '.ssh/key'), 'synthetic test value');
    const inspect = createPathInspector(context);
    for (const target of ['key', 'missing']) {
      const link = path.join(context.workspaceDir, target);
      await symlink(path.join(context.homeDir, '.ssh', target), link);
      expect((await inspect({ tool: 'Write', toolUseId: 'x', input: { file_path: link } }))?.verdict).toBe('deny');
    }
  });
  it('blocks recursive searches that would touch .env files', async () => {
    const { context } = await fixture();
    await mkdir(path.join(context.workspaceDir, 'nested'));
    await writeFile(path.join(context.workspaceDir, 'nested/.env.local'), 'synthetic');
    expect((await createPathInspector(context)({ tool: 'Grep', toolUseId: 'x', input: { pattern: '.' } }))?.verdict).toBe('deny');
  });
  it('allows an ordinary file target', async () => {
    const { context } = await fixture();
    expect(await createPathInspector(context)({ tool: 'Write', toolUseId: 'x', input: { file_path: 'new.txt' } })).toBeNull();
  });
});

describe('local records', () => {
  it('uses private fresh workspaces and durable exclusive transcripts', async () => {
    const { context } = await fixture();
    const options = { homeDir: context.homeDir, userId: 'test', miniclawHome: context.miniclawHome };
    const first = await createWorkspace(options);
    const second = await createWorkspace(options);
    expect(first.cwd).not.toBe(second.cwd);
    expect(first.cwd).toContain('/workspace/tmp/');
    expect((await stat(first.cwd)).mode & 0o777).toBe(0o700);
    const transcript = createTranscript(first.transcriptPath);
    transcript.write({ type: 'user.message', text: 'hello' });
    transcript.close(); transcript.close();
    expect(JSON.parse((await readFile(first.transcriptPath, 'utf8')).trim()).text).toBe('hello');
    expect((await stat(first.transcriptPath)).mode & 0o777).toBe(0o600);
    expect(() => createTranscript(first.transcriptPath)).toThrow();
  });
  it('reports a missing explicitly selected engine without falling back', async () => {
    const { root } = await fixture();
    const report = await detectClaudeEngine({ executablePath: path.join(root, 'missing') });
    expect(report.ready).toBe(false);
    expect(report.steps).toHaveLength(1);
    expect(report.executablePath).toBeNull();
  });
});
