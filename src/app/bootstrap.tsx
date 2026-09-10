import { homedir, userInfo } from 'node:os';
import { render } from 'ink';
import { createToolGate } from '../core/policy/gate.js';
import type { DetectionReport } from '../core/engine-detection.js';
import { createPathInspector } from '../infra/path-inspector.js';
import { createWorkspace } from '../infra/workspace.js';
import { createTranscript } from '../infra/transcript.js';
import { createApprovalBridge } from '../tui/approval-bridge.js';
import { createTheme } from '../tui/theme/index.js';
import { createChatController } from './controller.js';
import { demoAdapter } from './demo.js';
import { RootView } from './view.js';
import type { CliOptions } from './arguments.js';
import { selectEngine } from './engines.js';

function demoDetection(): DetectionReport {
  return { engineId: 'demo', ready: true, executablePath: null, version: null, fix: null,
    steps: [{ level: 'L1-locate', ok: true, detail: 'Simulated engine; no provider requests.', tried: ['--demo'] }] };
}

// 原则例外: this composition root explicitly wires one session's ownership and cleanup in one place.
export async function startInteractive(options: CliOptions): Promise<void> {
  if (!process.stdin.isTTY) throw new Error('Interactive chat needs a terminal. Use --doctor for a noninteractive check.');
  const engine = selectEngine(options);
  const createAdapter = options.demo ? () => demoAdapter : await engine.load();
  const homeDir = homedir();
  const userName = userInfo().username;
  const workspace = await createWorkspace({ homeDir,
    userId: userName.replace(/[^A-Za-z0-9_.-]/g, '_') || 'default',
    explicitDir: options.directory, miniclawHome: process.env.MINICLAW_HOME });
  const transcript = createTranscript(workspace.transcriptPath);
  const approvals = createApprovalBridge();
  const context = { homeDir, miniclawHome: workspace.miniclawHome, workspaceDir: workspace.cwd };
  let executablePath = engine.executablePath;
  const gate = createToolGate({ context, approvals: approvals.broker,
    events: { write: event => controller.record(event) }, inspect: createPathInspector(context) });
  const controller = createChatController({ transcript, denyApprovals: approvals.denyAll,
    openSession: () => {
      const adapter = createAdapter({ executablePath, model: options.model });
      return adapter.openSession({ cwd: workspace.cwd, toolGate: gate, model: options.model });
    } });
  const detect = async (pinnedPath?: string) => {
    if (options.demo) return demoDetection();
    const report = await engine.detect({ executablePath: pinnedPath ?? executablePath });
    if (report.ready && report.executablePath) executablePath = report.executablePath;
    return report;
  };
  let cleanup: Promise<void> | undefined;
  const close = () => cleanup ??= controller.close().finally(() => transcript.close());
  const exit = () => { void close().catch(error => {
    process.stderr.write(`Shutdown failed: ${String(error)}\n`); process.exitCode = 1;
  }).finally(() => instance.unmount()); };
  const theme = createTheme({ env: process.env, isTTY: Boolean(process.stdout.isTTY) });
  const instance = render(<RootView controller={controller} approvals={approvals} theme={theme}
    workspace={workspace.cwd} transcriptPath={workspace.transcriptPath} detect={detect}
    onExit={exit} demo={options.demo} userName={userName} engineId={options.engine} />, {
      exitOnCtrlC: false,
      kittyKeyboard: { mode: 'auto', flags: ['disambiguateEscapeCodes', 'reportAlternateKeys'] },
    });
  process.once('SIGTERM', exit);
  process.once('SIGINT', exit);
  try { await instance.waitUntilExit(); }
  finally { process.off('SIGTERM', exit); process.off('SIGINT', exit); await close(); }
}
