import { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import type { DetectionReport } from '../core/engine-detection.js';
import type { PendingApproval } from './approval-bridge.js';
import { COPY, greetingFor } from './copy.js';
import { crabLines, gradientText, isCrabSnipping, logoLines, useTheme, MASCOT, WORDMARK } from './theme/index.js';

interface WelcomeProps { readonly detection: DetectionReport | null; readonly width: number; readonly userName: string }

function useWelcomeElapsed(reducedMotion: boolean): number {
  const [elapsed, setElapsed] = useState(reducedMotion ? 1400 : 0);
  useEffect(() => {
    if (reducedMotion || elapsed >= 1400) return;
    const started = Date.now() - elapsed;
    const timer = setInterval(() => setElapsed(Math.min(Date.now() - started, 1400)), 34);
    return () => clearInterval(timer);
  }, [elapsed >= 1400, reducedMotion]);
  return elapsed;
}

function RuntimeCheck({ detection }: { detection: DetectionReport | null }) {
  const theme = useTheme();
  const separator = theme.ascii ? ' / ' : ' · ';
  const label = detection ? detection.ready ? `ready${separator}${detection.version ?? 'demo'}` : 'needs attention' : (theme.ascii ? 'checking...' : 'checking…');
  return <Box flexDirection="column">
    <Text color={theme.semantic(detection?.ready ? 'success' : 'warning')}>
      {theme.glyph(detection?.ready ? 'success' : 'warning')} runtime  {label}
    </Text>
    {detection?.steps.map((step) => <Box key={step.level} flexDirection="column">
      <Text color={theme.color('muted')}>  {theme.glyph(step.ok ? 'success' : 'warning')} {step.detail}</Text>
      {!step.ok && step.tried.map((path) => <Text key={path} color={theme.color('muted')}>tried: {path}</Text>)}
    </Box>)}
    {detection?.fix && <Text color={theme.semantic('warning')}>fix: {detection.fix}</Text>}
    {detection && !detection.ready && <Text color={theme.color('muted')}>Re-checking every 5s{separator}/path &lt;executable&gt;</Text>}
  </Box>
}

export function Welcome({ detection, width, userName }: WelcomeProps) {
  const theme = useTheme();
  const styled = theme.depth !== 'none';
  const compact = width < theme.tokens.layout.breakpoints.regular || theme.ascii;
  const showCrab = width >= theme.tokens.layout.welcomeCrabMinWidth;
  const elapsed = useWelcomeElapsed(theme.reducedMotion);
  const greeting = `${greetingFor(new Date().getHours())}, ${userName}`;
  return <Box flexDirection="column" marginBottom={1}>
    {compact ? <Text bold={styled}>{theme.ascii ? MASCOT.ascii : MASCOT.unicode} {gradientText(theme, WORDMARK, { start: 0, end: 1, bold: styled })}</Text>
      : <Box gap={showCrab ? 2 : 0}>
        {showCrab && <Box flexDirection="column">{crabLines(theme, isCrabSnipping(theme, elapsed)).map((line, index) => <Text key={index}>{line}</Text>)}</Box>}
        <Box flexDirection="column">{logoLines(theme, elapsed).map((line, index) => <Text key={index}>{line}</Text>)}</Box>
      </Box>}
    {!compact && <Text color={theme.color('muted')}>{COPY.welcome.tagline}</Text>}
    <Box flexDirection="column" borderStyle={compact ? undefined : theme.border('rounded')}
      borderColor={theme.module('chat')} paddingX={compact ? 0 : 1} marginTop={1}>
      <Text bold={styled}>{greeting} <Text color={theme.color('subtle')}>{theme.ascii ? '/' : '·'} {COPY.welcome.version}</Text></Text>
      <RuntimeCheck detection={detection} />
    </Box>
  </Box>
}

export function ApprovalCard({ pending, count }: { pending: PendingApproval; count: number }) {
  const theme = useTheme();
  const styled = theme.depth !== 'none';
  return <Box flexDirection="column" borderStyle={theme.border('heavy')} borderColor={theme.semantic('permission')} paddingX={1}>
    <Text bold={styled} color={theme.semantic('permission')}>{theme.glyph('permission')} Approval needed {theme.ascii ? '/' : '·'} {pending.request.tool}</Text>
    <Text>{pending.request.summary}</Text>
    <Text color={theme.color('muted')}>{pending.request.reason}</Text>
    <Text><Text bold={styled}> enter </Text> deny  <Text bold={styled}> a </Text> once  <Text bold={styled}> s </Text> session</Text>
    <Text color={theme.color('muted')}>Default is deny. Approval requires an explicit a or s.</Text>
    {count > 1 && <Text>{count - 1} more waiting</Text>}
  </Box>;
}
