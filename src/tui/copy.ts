// Every string miniclaw itself renders (DESIGN §3.1): English, sentence case for sentences,
// lowercase for short labels. Components look copy up here; a future zh table replaces this file.

/** Key names shown in hint badges. They are copy, so each has an ASCII spelling for MINICLAW_ASCII. */
export const KEYS = {
  enter: { unicode: '⏎', ascii: 'enter' },
  altEnter: { unicode: '⌥⏎', ascii: 'alt+enter' },
  slash: { unicode: '/', ascii: '/' },
  escape: { unicode: 'esc', ascii: 'esc' },
  ctrlC: { unicode: '⌃C', ascii: 'ctrl+c' },
  approveOnce: { unicode: 'a', ascii: 'a' },
  approveSession: { unicode: 's', ascii: 's' },
  deny: { unicode: 'd', ascii: 'd' },
  pinPath: { unicode: 'p', ascii: 'p' },
} as const;

export type KeyName = keyof typeof KEYS;

export const COPY = {
  separator: ' · ',
  ellipsis: '…',
  welcome: {
    tagline: 'a lightweight OpenClaw for your terminal',
    placeholder: 'Try "summarize the files in this folder"',
    runtimeLabel: 'runtime',
    checking: 'checking…',
    recheckEvery: 'Re-checking every 5s',
    pinHint: 'pin a path (coming soon)',
    triedLabel: 'tried',
    fixLabel: 'fix',
    comingLabel: 'more',
    comingSoon: 'profiles, skills and schedules arrive in v0.2+',
    detectFailed: 'Engine check failed',
    productLine: 'local agent runtime',
    version: 'v0.1.0',
    demoReady: 'demo ready',
    liveReady: 'agent ready',
  },
  greeting: { lateNight: 'Still up', morning: 'Good morning', afternoon: 'Good afternoon', evening: 'Good evening' },
  hints: {
    send: 'send',
    newline: 'newline',
    commands: 'cmd',
    interrupt: 'stop',
    quit: 'quit',
  },
  input: {
    busy: 'Agent is working… press esc to stop',
    approvalOpen: 'Answer the approval above first',
    notReady: 'Waiting for the engine check to pass…',
    placeholder: 'Ask your agent anything…',
  },
  chat: {
    thinking: 'Thinking…',
    interrupted: 'Interrupted',
    interruptedHint: 'The turn was stopped. Send a new message to continue.',
    interrupting: 'stopping…',
    errorHint: 'Fix the problem and send your message again.',
    denied: 'denied',
    approvedOnce: 'approved',
    cancelled: 'cancelled',
    running: 'running',
    tokens: 'tok',
    cleared: 'View cleared. Your agent still remembers this conversation.',
    notReady: 'The engine is not ready yet, so nothing was sent. See the runtime check above.',
    unknownCommand: (name: string) => `Unknown command /${name}. Type /help for the list.`,
  },
  help: {
    title: 'Commands',
    lines: [
      ['/help', 'show this help'],
      ['/clear', 'clear the screen (the agent keeps the conversation context)'],
      ['/exit', 'close the session and quit'],
    ],
    keysTitle: 'Keys',
    keys: [
      ['enter', 'send'],
      ['alt+enter', 'new line (shift+enter in terminals with the kitty keyboard protocol)'],
      ['\\ + enter', 'new line in any terminal (end the line with a backslash)'],
      ['esc', 'stop the current reply'],
      ['ctrl+c', 'quit'],
    ],
  },
  approval: {
    title: 'Approval needed',
    wants: (tool: string) => `The agent wants to use ${tool}`,
    actionLabel: 'action',
    reasonLabel: 'reason',
    once: 'once',
    session: 'session',
    deny: 'deny',
    defaultDeny: 'default: deny',
    queued: (count: number) => `+${count} waiting`,
  },
  status: {
    checking: 'checking engine…',
    notReady: 'engine not ready',
    working: 'working',
    noModel: 'default model',
    usageUnavailable: 'usage —',
    costUnavailable: 'cost —',
    demo: 'demo · no API',
    ready: 'ready',
  },
} as const;

export type Greeting = keyof typeof COPY.greeting;

/** Salutation by local hour (DESIGN §8.1). */
export function greetingFor(hour: number): string {
  if (hour < 5) return COPY.greeting.lateNight;
  if (hour < 12) return COPY.greeting.morning;
  if (hour < 18) return COPY.greeting.afternoon;
  return COPY.greeting.evening;
}
