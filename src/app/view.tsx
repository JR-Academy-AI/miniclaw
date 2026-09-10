import { useEffect, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import type { DetectionReport } from '../core/engine-detection.js';
import { App } from '../tui/App.js';
import { chatReducer, initialChatState } from '../tui/chat-state.js';
import type { ApprovalBridge } from '../tui/approval-bridge.js';
import type { Theme } from '../tui/theme/index.js';
import type { ChatController } from './controller.js';

interface ViewOptions {
  readonly controller: ChatController;
  readonly approvals: ApprovalBridge;
  readonly theme: Theme;
  readonly workspace: string;
  readonly transcriptPath: string;
  readonly detect: (path?: string) => Promise<DetectionReport>;
  readonly onExit: () => void;
  readonly demo: boolean;
  readonly userName: string;
  readonly engineId: 'codex' | 'claude';
}

function useChatView(controller: ChatController) {
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const cursor = useRef(0);
  useEffect(() => {
    const pump = () => {
      const events = controller.snapshot().events;
      if (events.length < cursor.current) cursor.current = 0;
      for (const event of events.slice(cursor.current)) dispatch({ type: 'engine', event, at: Date.now() });
      cursor.current = events.length;
    };
    const unsubscribe = controller.subscribe(pump);
    pump();
    return unsubscribe;
  }, [controller]);
  return { state, dispatch };
}

function useDetection(detect: ViewOptions['detect'], engineId: ViewOptions['engineId']) {
  const [report, setReport] = useState<DetectionReport | null>(null);
  const [path, setPath] = useState<string>();
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      try {
        const next = await detect(path);
        if (disposed) return;
        setReport(next);
        if (!next.ready) timer = setTimeout(() => { void check(); }, 5000);
      } catch (error) {
        if (disposed) return;
        setReport({ engineId, ready: false, steps: [], executablePath: null, version: null,
          fix: `Engine check failed: ${error instanceof Error ? error.message : String(error)}. Try --doctor.` });
        timer = setTimeout(() => { void check(); }, 5000);
      }
    };
    void check();
    return () => { disposed = true; if (timer) clearTimeout(timer); };
  }, [detect, engineId, path]);
  return { report, pin: setPath };
}

export function RootView(options: ViewOptions) {
  const { state, dispatch } = useChatView(options.controller);
  const snapshot = useSyncExternalStore(options.controller.subscribe, options.controller.snapshot);
  const detection = useDetection(options.detect, options.engineId);
  const [notice, setNotice] = useState(options.demo ? 'DEMO: simulated engine, no provider requests or tool writes.' : '');
  const submit = (text: string) => {
    if (text === '/exit') { options.onExit(); return; }
    if (text === '/help') { dispatch({ type: 'notice', notice: { type: 'help' } }); return; }
    if (text === '/clear') { options.controller.clear(); dispatch({ type: 'cleared' }); return; }
    if (text.startsWith('/')) { dispatch({ type: 'notice', notice: { type: 'unknown-command', name: text.slice(1) } }); return; }
    if (!detection.report?.ready) { dispatch({ type: 'notice', notice: { type: 'not-ready' } }); return; }
    dispatch({ type: 'submitted', text, at: Date.now() });
    void options.controller.submit(text);
  };
  return <App theme={options.theme} state={state} detection={detection.report} busy={snapshot.busy}
    approvals={options.approvals} workspace={options.workspace} transcriptPath={options.transcriptPath}
    onSubmit={submit} onExit={options.onExit} notice={notice} userName={options.userName} demo={options.demo}
    onInterrupt={() => { dispatch({ type: 'stop-requested' }); void options.controller.interrupt(); }}
    onPinPath={path => {
      if (state.sessionId || snapshot.busy) { setNotice('Restart miniclaw to change the engine for an existing conversation.'); return; }
      detection.pin(path); setNotice('Checking the selected engine executable...');
    }} />;
}
