import { Box, Text } from 'ink';
import type { ChatBlock } from './chat-blocks.js';
import { COPY } from './copy.js';
import { useTheme } from './theme/index.js';

function Markdown({ text }: { text: string }) {
  const theme = useTheme();
  const styled = theme.depth !== 'none';
  let code = false;
  return <Box flexDirection="column">{text.split('\n').map((line, index) => {
    if (line.startsWith('```')) { code = !code; return <Text key={index} color={theme.color('muted')}>{line || ' '}</Text>; }
    if (code) return <Text key={index} color={theme.color('lagoon')}>{line || ' '}</Text>;
    const heading = /^#{1,6}\s/.test(line);
    const pieces = line.replace(/^#{1,6}\s/, '').split(/(\*\*[^*]+\*\*|`[^`]+`)/);
    return <Text key={index} bold={styled && heading}>{pieces.map((part, i) => {
      if (part.startsWith('**')) return <Text key={i} bold={styled}>{part.slice(2, -2)}</Text>;
      if (part.startsWith('`')) return <Text key={i} color={theme.color('lagoon')}>{part.slice(1, -1)}</Text>;
      return part || (pieces.length === 1 ? ' ' : '');
    })}</Text>;
  })}</Box>;
}

export function TranscriptBlock({ block, expanded, runtimeName = 'agent' }: {
  block: ChatBlock; expanded: boolean; runtimeName?: string;
}) {
  const theme = useTheme();
  const styled = theme.depth !== 'none';
  switch (block.kind) {
    case 'user': return <Box marginTop={1}><Text color={theme.module('chat')} bold={styled}>{theme.glyph('prompt')} {block.text}</Text></Box>;
    case 'agent-header': return <Box marginTop={1}><Text color={theme.module('chat')} bold={styled}>
      {theme.glyph('running')} agent <Text color={theme.color('subtle')}>· {runtimeName} · {new Date(block.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
    </Text></Box>;
    case 'text': return <Box><Text color={theme.module('chat')}>{theme.glyph('thread')} </Text><Markdown text={block.text} /></Box>;
    case 'thinking': return <Text color={theme.color('muted')} italic={styled}>{theme.glyph(expanded ? 'expanded' : 'collapsed')} {expanded ? block.text : 'Thinking…  ctrl+t expand'}</Text>;
    case 'tool': return <Box flexDirection="column"><Text color={theme.semantic(block.status === 'denied' || block.status === 'error' ? 'warning' : 'info')}>
      {theme.glyph(block.status === 'running' ? 'running' : block.status === 'ok' ? 'success' : 'cancelled')} <Text bold={styled}>{block.tool.padEnd(6)}</Text> <Text color={theme.color('muted')}>{block.summary}</Text>  {block.status}
    </Text>{block.detail && <Text color={theme.color('subtle')}>  {theme.glyph('result')} {block.detail}</Text>}</Box>;
    case 'turn-meta': return <Text color={theme.color('muted')}>{(block.durationMs / 1000).toFixed(1)}s / {block.tokens ?? '?'} tok / {block.costUsd === null ? 'cost unavailable' : `$${block.costUsd.toFixed(4)}`}</Text>;
    case 'interrupted': return <Text color={theme.semantic('warning')}>{COPY.chat.interrupted}. {COPY.chat.interruptedHint}</Text>;
    case 'error': return <Box flexDirection="column"><Text color={theme.semantic('error')}>{block.error.kind}: {block.error.message}</Text><Text>{block.error.hint ?? COPY.chat.errorHint}</Text></Box>;
    case 'notice': {
      if (block.notice.type === 'help') return <Box flexDirection="column">{[...COPY.help.lines, ...COPY.help.keys].map(([key, value]) => <Text key={key}>{key} - {value}</Text>)}</Box>;
      const text = block.notice.type === 'cleared' ? COPY.chat.cleared : block.notice.type === 'not-ready' ? COPY.chat.notReady : COPY.chat.unknownCommand(block.notice.name);
      return <Text color={theme.color('muted')}>{text}</Text>;
    }
  }
}
