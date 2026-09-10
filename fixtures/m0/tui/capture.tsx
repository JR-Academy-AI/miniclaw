// Local deterministic renderer; no engine or provider connection.
import { writeFileSync } from 'node:fs';
import React from 'react';
import { render, cleanup } from 'ink-testing-library';
import { App } from '../../../src/tui/App.js';
import { createApprovalBridge } from '../../../src/tui/approval-bridge.js';
import { createTheme } from '../../../src/tui/theme/index.js';
import { initialChatState } from '../../../src/tui/chat-state.js';

const approvals = createApprovalBridge();
void approvals.broker.request({ toolUseId: 'fixture', tool: 'Write',
  summary: 'Write a summary to notes.md', reason: 'A file write needs your permission.' });
const theme = createTheme({ env: { NO_COLOR: '1', MINICLAW_ASCII: '1' }, isTTY: false });
for (const width of [50, 80, 120]) {
  const screen = render(<App theme={theme} state={initialChatState} busy={false} approvals={approvals}
    detection={{ engineId: 'demo', ready: true, version: 'fixture (no live connection)', steps: [], executablePath: null, fix: null }}
    onSubmit={() => {}} onInterrupt={() => {}} onExit={() => {}}
    workspace="/fixture/workspace" transcriptPath="/fixture/events.jsonl" />);
  Object.defineProperty(screen.stdout, 'columns', { value: width });
  await new Promise((resolve) => setTimeout(resolve, 30));
  screen.stdout.emit('resize');
  await new Promise((resolve) => setTimeout(resolve, 30));
  writeFileSync(new URL(`./approval-${width}.txt`, import.meta.url), screen.lastFrame() + '\n');
  cleanup();
}
approvals.denyAll();

const reef = createTheme({ env: { NO_COLOR: '1', MINICLAW_REDUCED_MOTION: '1' }, isTTY: true },
  { depth: 'none', ascii: false, reducedMotion: true });
for (const width of [50, 80, 120]) {
  const screen = render(<App theme={reef} state={initialChatState} busy={false} approvals={createApprovalBridge()}
    detection={{ engineId: 'demo', ready: true, version: 'demo',
      steps: [{ level: 'L1-locate', ok: true, detail: 'Simulated engine; no provider requests.', tried: ['--demo'] }],
      executablePath: null, fix: null }} onSubmit={() => {}} onInterrupt={() => {}} onExit={() => {}}
    workspace="/fixture/workspace" transcriptPath="/fixture/events.jsonl" userName="lightman" demo />);
  Object.defineProperty(screen.stdout, 'columns', { value: width });
  await new Promise((resolve) => setTimeout(resolve, 30));
  screen.stdout.emit('resize');
  await new Promise((resolve) => setTimeout(resolve, 30));
  writeFileSync(new URL(`./welcome-${width}.txt`, import.meta.url), screen.lastFrame() + '\n');
  cleanup();
}
