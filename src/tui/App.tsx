import { useState, useSyncExternalStore, useEffect, useRef } from 'react';
import { Box, Static, Text, useInput, useStdout } from 'ink';
import type { DetectionReport } from '../core/engine-detection.js';
import type { ApprovalBridge } from './approval-bridge.js';
import { type ChatState, sumTokens } from './chat-state.js';
import { MASCOT, WORDMARK, ThemeProvider, truncateStart, type Theme, useTheme } from './theme/index.js';
import { ApprovalCard, Welcome } from './cards.js';
import { TranscriptBlock } from './transcript.js';
import { approvalKey, editInput, emptyEditor, hasNewlineIntent, isReturnInput } from './input.js';
import { COPY } from './copy.js';
import { CommandMenu, matchingCommands } from './command-menu.js';

export interface AppProps {
  readonly theme: Theme;
  readonly detection: DetectionReport | null;
  readonly state: ChatState;
  readonly busy: boolean;
  readonly approvals: ApprovalBridge;
  readonly onSubmit: (text: string) => void;
  readonly onInterrupt: () => void;
  readonly onExit: () => void;
  readonly onPinPath?: (path: string) => void;
  readonly workspace: string;
  readonly transcriptPath: string;
  readonly notice?: string;
  readonly userName?: string;
  readonly demo?: boolean;
}

function useWidth() {
  const { stdout } = useStdout();
  const [width, setWidth] = useState(stdout.columns || 80);
  useEffect(() => {
    const resize = () => setWidth(stdout.columns || 80);
    stdout.on('resize', resize);
    return () => { stdout.off('resize', resize); };
  }, [stdout]);
  return width;
}

function useComposer(props: AppProps) {
  const [editor, setEditor] = useState(emptyEditor);
  const editorRef = useRef(editor);
  const updateEditor = (next: typeof editor) => { editorRef.current = next; setEditor(next); };
  const [expanded, setExpanded] = useState(false);
  const [commandIndex, setCommandIndex] = useState(0);
  const pending = useSyncExternalStore(props.approvals.subscribe, props.approvals.pending);
  useInput((input, key) => {
    if (key.eventType === 'release') return;
    const currentEditor = editorRef.current;
    const actualKey = isReturnInput(input, key) && !key.return ? { ...key, return: true } : key;
    const commands = matchingCommands(currentEditor.text);
    if (key.ctrl && input === 'c') { props.approvals.denyAll(); props.onExit(); return; }
    if (pending[0]) {
      if (actualKey.escape) { props.approvals.denyAll(); props.onInterrupt(); return; }
      if (actualKey.ctrl || actualKey.meta || actualKey.eventType === 'release') return;
      const choice = approvalKey(input, actualKey);
      if (choice) props.approvals.respond(pending[0].id, choice);
      return;
    }
    if (commands.length > 0 && actualKey.escape) { updateEditor(emptyEditor); setCommandIndex(0); return; }
    if (commands.length > 0 && (actualKey.upArrow || actualKey.downArrow)) {
      const step = actualKey.downArrow ? 1 : -1;
      setCommandIndex((commandIndex + step + commands.length) % commands.length); return;
    }
    if (actualKey.escape) { props.onInterrupt(); return; }
    if (actualKey.ctrl && input === 't') { setExpanded(!expanded); return; }
    if (props.busy) return;
    if (hasNewlineIntent(currentEditor, actualKey)) {
      const base = currentEditor.text.endsWith('\\') ? { text: currentEditor.text.slice(0, -1), cursor: currentEditor.cursor - 1 } : currentEditor;
      updateEditor(editInput(base, '', actualKey)); return;
    }
    if (actualKey.return) {
      const selected = commands[Math.min(commandIndex, commands.length - 1)];
      const text = selected?.name ?? currentEditor.text.trim();
      if (text.startsWith('/path ') && props.onPinPath) props.onPinPath(text.slice(6).trim());
      else if (text) props.onSubmit(text);
      updateEditor(emptyEditor); setCommandIndex(0); return;
    }
    updateEditor(editInput(currentEditor, input, actualKey));
    if (input) setCommandIndex(0);
  });
  return { editor, expanded, pending, commandIndex };
}

function Header() {
  const theme = useTheme();
  return <Box marginBottom={1}>
    <Text bold={theme.depth !== 'none'} color={theme.module('chat')}>{theme.ascii ? MASCOT.ascii : MASCOT.unicode} {WORDMARK}</Text>
    <Text color={theme.color('muted')}>  Chat</Text>
  </Box>;
}

function Status({ state }: { state: ChatState }) {
  const theme = useTheme();
  const separator = theme.ascii ? ' / ' : ' · ';
  const tokens = state.turnUsage ? sumTokens(state.turnUsage) : state.totals ? sumTokens(state.totals) : null;
  const cost = state.turnCostUsd ?? state.costUsd;
  const usage = tokens === null ? (theme.ascii ? 'usage -' : COPY.status.usageUnavailable) : `${tokens} tok`;
  const price = cost === null ? (theme.ascii ? 'cost -' : COPY.status.costUnavailable) : `$${cost.toFixed(4)}`;
  const suffix = state.usageCompleteness === 'partial' ? `${separator}partial` : '';
  return <Text color={theme.color('muted')}>{state.model ?? COPY.status.noModel}{separator}{usage}{separator}{price}{suffix}</Text>;
}

function Composer({ editor, busy }: { editor: { text: string; cursor: number }; busy: boolean }) {
  const theme = useTheme();
  const styled = theme.depth !== 'none';
  const before = editor.text.slice(0, editor.cursor);
  const cursor = editor.text[editor.cursor] ?? ' ';
  const after = editor.text.slice(editor.cursor + 1);
  return <Box borderStyle={theme.border('rounded')} borderColor={theme.module('chat')} paddingX={1}>
    <Text color={theme.module('chat')}>{theme.glyph('prompt')} </Text>
    {busy ? <Text color={theme.color('muted')}>{COPY.input.busy}</Text>
      : editor.text.length === 0 ? <Text><Text inverse={styled}> </Text><Text color={theme.color('subtle')}> {theme.ascii ? COPY.input.placeholder.replace('…', '...') : COPY.input.placeholder}</Text></Text>
      : <Text>{before}<Text inverse={styled}>{cursor}</Text>{after}</Text>}
  </Box>;
}

function Conversation(props: AppProps) {
  const theme = useTheme();
  const width = useWidth();
  const { editor, expanded, pending, commandIndex } = useComposer(props);
  const compact = width < theme.tokens.layout.breakpoints.regular;
  const names: Record<string, string> = { codex: 'Codex', claude: 'Claude Code', 'claude-code': 'Claude Code', demo: 'demo' };
  const runtimeName = names[props.detection?.engineId ?? ''] ?? 'agent';
  return <Box flexDirection="column" width={Math.max(30, width - (compact ? 0 : theme.tokens.layout.gutter * 2))}
    marginX={compact ? 0 : theme.tokens.layout.gutter}>
    {props.state.started && <Header />}
    <Static key={props.state.epoch} items={[...props.state.committed]}>{(block) => <TranscriptBlock key={block.key} block={block} expanded={expanded} runtimeName={runtimeName} />}</Static>
    {!props.state.started && <Welcome detection={props.detection} width={width} userName={props.userName ?? 'there'} />}
    {props.state.live.map((block) => <TranscriptBlock key={block.key} block={block} expanded={expanded} runtimeName={runtimeName} />)}
    {pending[0] && <ApprovalCard pending={pending[0]} count={pending.length} />}
    {props.notice && <Text color={theme.semantic('warning')}>{props.notice}</Text>}
    <CommandMenu commands={matchingCommands(editor.text)} selected={commandIndex} />
    <Composer editor={editor} busy={props.busy} />
    <Box justifyContent="space-between" flexWrap="wrap">
      <Status state={props.state} />
      <Text color={theme.color('muted')}>{compact
        ? (theme.ascii ? 'enter send / esc stop / ? /help' : 'enter send · esc stop · ? /help')
        : (theme.ascii ? 'enter send / alt+enter newline / esc stop / ctrl+c exit / /help' : 'enter send · alt+enter newline · esc stop · ctrl+c exit · /help')}</Text>
    </Box>
    {!props.state.started && !compact && <Text color={theme.color('subtle')}>
      workspace  {truncateStart(props.workspace, Math.max(20, width - 14))}{'\n'}
      log        {truncateStart(props.transcriptPath, Math.max(20, width - 14))}
    </Text>}
  </Box>;
}

export function App(props: AppProps) {
  return <ThemeProvider theme={props.theme}><Conversation {...props} /></ThemeProvider>;
}
