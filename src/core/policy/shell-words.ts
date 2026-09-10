// A small, quote-aware splitter for shell commands. It is NOT a shell parser: it only needs to
// find command words, arguments and redirection targets well enough for policy rules, and every
// ambiguity must lean towards "more words / more segments" (which can only deny or ask more).

export interface ShellSegment {
  /** Words of one simple command, quotes removed. words[0] is the command (or an assignment). */
  readonly words: readonly string[];
  /** Targets of `>`, `>>`, `<`, `2>` … in this segment. */
  readonly redirects: readonly string[];
}

// Unquoted characters that end a simple command. `(`, `)` and backticks make the body of
// `$(…)`, `(…)` and `` `…` `` its own segment, so a command hidden inside is still seen.
const SEGMENT_BREAKS = new Set([';', '&', '|', '\n', '(', ')', '`']);
const REDIRECT_CONTINUATION = /[<>&|]/;
const WHITESPACE = /\s/;
const FD_NUMBER = /^\d+$/;

interface ParseState {
  readonly segments: ShellSegment[];
  words: string[];
  redirects: string[];
  current: string;
  inWord: boolean;
  quote: '' | "'" | '"';
  nextWordIsRedirect: boolean;
}

export function parseShell(command: string): ShellSegment[] {
  const state: ParseState = {
    segments: [],
    words: [],
    redirects: [],
    current: '',
    inWord: false,
    quote: '',
    nextWordIsRedirect: false,
  };
  for (let index = 0; index < command.length; index++) {
    index = state.quote ? stepQuoted(state, command, index) : stepUnquoted(state, command, index);
  }
  endSegment(state);
  return state.segments;
}

/** True when the command runs commands whose text is built at run time. */
export function hasCommandSubstitution(command: string): boolean {
  return /\$\(|`|<\(|>\(/.test(command);
}

function stepUnquoted(state: ParseState, command: string, index: number): number {
  const char = command.charAt(index);
  if (char === '\\') return appendEscaped(state, command, index);
  if (char === "'" || char === '"') {
    state.quote = char;
    state.inWord = true;
    return index;
  }
  if (SEGMENT_BREAKS.has(char)) {
    endSegment(state);
    return index;
  }
  if (char === '<' || char === '>') return startRedirect(state, command, index);
  if (WHITESPACE.test(char)) {
    endWord(state);
    return index;
  }
  state.current += char;
  state.inWord = true;
  return index;
}

function stepQuoted(state: ParseState, command: string, index: number): number {
  const char = command.charAt(index);
  if (char === state.quote) {
    state.quote = '';
    return index;
  }
  if (char === '\\' && state.quote === '"') return appendEscaped(state, command, index);
  state.current += char;
  return index;
}

function appendEscaped(state: ParseState, command: string, index: number): number {
  state.current += command.charAt(index + 1);
  state.inWord = true;
  return index + 1;
}

function startRedirect(state: ParseState, command: string, index: number): number {
  if (FD_NUMBER.test(state.current)) {
    state.current = '';
    state.inWord = false;
  } else {
    endWord(state);
  }
  let last = index;
  while (last + 1 < command.length && REDIRECT_CONTINUATION.test(command.charAt(last + 1))) last++;
  state.nextWordIsRedirect = true;
  return last;
}

function endWord(state: ParseState): void {
  if (!state.inWord) return;
  if (state.nextWordIsRedirect) state.redirects.push(state.current);
  else state.words.push(state.current);
  state.current = '';
  state.inWord = false;
  state.nextWordIsRedirect = false;
}

function endSegment(state: ParseState): void {
  endWord(state);
  if (state.words.length > 0 || state.redirects.length > 0) {
    state.segments.push({ words: state.words, redirects: state.redirects });
  }
  state.words = [];
  state.redirects = [];
  state.nextWordIsRedirect = false;
}
