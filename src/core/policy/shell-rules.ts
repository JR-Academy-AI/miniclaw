// Policy rules that need to look inside a Bash command. Every helper over-approximates: a false
// match can only turn "ask" into "deny", never "ask" into "allow" (Bash is never allowed by rule).
import type { Decision, PolicyContext } from './types.js';
import { parseShell, type ShellSegment } from './shell-words.js';
import { protectedRoots } from './hard-floor.js';
import { baseName, displayPath, isInside, resolveToolPath } from './path-utils.js';

interface LocatedSegment {
  readonly segment: ShellSegment;
  /** Directory the segment runs in after earlier `cd`s; null when it cannot be known statically. */
  readonly cwd: string | null;
}

const DELETE_COMMANDS = new Set(['rm', 'rmdir', 'unlink', 'shred', 'srm']);
const COMMAND_PREFIXES = new Set([
  'sudo', 'doas', 'command', 'builtin', 'exec', 'nice', 'nohup', 'time', 'env', 'xargs',
]);
const FIND_EXEC_FLAGS = new Set(['-exec', '-execdir', '-ok', '-okdir']);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const RAW_PIECE_SEPARATORS = /[\s'"`;|&<>()=,:]+/;
const PATH_LIKE = /^(?:~|\$HOME|\$\{HOME\}|\/|\.)/;
/** Paths that resolve without knowing the cwd. */
const SELF_ROOTED = /^(?:~|\$HOME|\$\{HOME\}|\/)/;

/** Every path a shell command may touch, resolved to absolute form. */
export function shellCommandPaths(command: string, context: PolicyContext): string[] {
  const paths = new Set<string>();
  for (const { segment, cwd } of locateSegments(command, context)) {
    if (cwd === null) continue;
    for (const word of segmentPathWords(segment)) addResolved(paths, word, cwd, context);
  }
  // Paths embedded in quoted code (`python -c "open('~/.ssh/id_rsa')"`) are not shell words.
  for (const piece of command.split(RAW_PIECE_SEPARATORS)) {
    if (PATH_LIKE.test(piece) || piece.includes('/')) addResolved(paths, piece, context.workspaceDir, context);
  }
  for (const root of protectedRoots(context.homeDir)) {
    if (mentionsPath(command, root.path, context.homeDir)) paths.add(root.path);
  }
  return [...paths];
}

/** Bash rm / rmdir / unlink / shred / `find -delete`: deny outside the workspace, ask inside. */
export function checkShellDelete(command: string, context: PolicyContext): Decision | null {
  let deletes = false;
  for (const { segment, cwd } of locateSegments(command, context)) {
    const targets = deleteTargets(segment.words);
    if (targets === null) continue;
    deletes = true;
    const outside = targets.map((target) => resolveTarget(target, cwd, context)).find(isOutside(context));
    if (outside) {
      const where = displayPath(outside, context.homeDir);
      const reason = `permanently deletes ${where}, outside this session's workspace`;
      return decision('deny', 'hard-delete.outside-workspace', reason);
    }
  }
  return deletes ? decision('deny', 'hard-floor.delete', 'permanent deletion is not supported; use the trash outside miniclaw') : null;
}

/**
 * True when a command mentions `absolutePath` in any home-relative spelling (`~/x`, `$HOME/x`,
 * `${HOME}/x`, `/Users/me/x`). Catches paths with spaces inside quoted code, which word splitting misses.
 */
export function mentionsPath(command: string, absolutePath: string, homeDir: string): boolean {
  const spellings = [absolutePath];
  if (isInside(absolutePath, homeDir) && absolutePath !== homeDir) {
    const relative = absolutePath.slice(homeDir.length);
    spellings.push(`~${relative}`, `$HOME${relative}`, `\${HOME}${relative}`);
  }
  return spellings.some((spelling) => new RegExp(`${escapeRegExp(spelling)}(?![\\w.-])`, 'i').test(command));
}

export function locateSegments(command: string, context: PolicyContext): LocatedSegment[] {
  let cwd: string | null = context.workspaceDir;
  return parseShell(command).map((segment) => {
    const located = { segment, cwd };
    cwd = nextCwd(segment, cwd, context);
    return located;
  });
}

function nextCwd(segment: ShellSegment, cwd: string | null, context: PolicyContext): string | null {
  const [command, ...args] = segment.words;
  if (command !== 'cd' && command !== 'pushd') return cwd;
  const target = args.find((arg) => !arg.startsWith('-') || arg === '-');
  if (target === undefined) return context.homeDir;
  if (target === '-' || (cwd === null && !SELF_ROOTED.test(target))) return null;
  return resolveToolPath(target, { homeDir: context.homeDir, baseDir: cwd ?? context.workspaceDir });
}

function segmentPathWords(segment: ShellSegment): string[] {
  const [command = '', ...args] = segment.words;
  const words = command.includes('/') ? [command] : [];
  for (const word of [...args, ...segment.redirects]) {
    const value = optionValue(word);
    if (value !== null) words.push(value);
  }
  return words;
}

// `--file=~/.ssh/x` → `~/.ssh/x`; a bare flag (`-rf`) is not a path.
function optionValue(word: string): string | null {
  if (!word.startsWith('-')) return word;
  const equals = word.indexOf('=');
  return equals === -1 ? null : word.slice(equals + 1);
}

function addResolved(paths: Set<string>, word: string, cwd: string, context: PolicyContext): void {
  const resolved = resolveToolPath(word, { homeDir: context.homeDir, baseDir: cwd });
  if (resolved !== null) paths.add(resolved);
}

/** Targets of a delete command, `[]` when they come from stdin, null when the segment deletes nothing. */
function deleteTargets(words: readonly string[]): string[] | null {
  let index = 0;
  while (index < words.length && isCommandPrefix(words[index] ?? '')) index++;
  const command = baseName(words[index] ?? '');
  const args = words.slice(index + 1);
  if (DELETE_COMMANDS.has(command)) return operands(args);
  if (command === 'find') return findDeleteRoots(args);
  return null;
}

function isCommandPrefix(word: string): boolean {
  return ASSIGNMENT.test(word) || COMMAND_PREFIXES.has(word) || word.startsWith('-');
}

function operands(args: readonly string[]): string[] {
  const endOfFlags = args.indexOf('--');
  const flagged = endOfFlags === -1 ? args : args.slice(0, endOfFlags);
  const plain = endOfFlags === -1 ? [] : args.slice(endOfFlags + 1);
  return [...flagged.filter((arg) => !arg.startsWith('-')), ...plain];
}

function findDeleteRoots(args: readonly string[]): string[] | null {
  const execDeletes = args.some(
    (arg, index) => FIND_EXEC_FLAGS.has(arg) && DELETE_COMMANDS.has(baseName(args[index + 1] ?? '')),
  );
  if (!args.includes('-delete') && !execDeletes) return null;
  const firstExpression = args.findIndex((arg) => arg.startsWith('-') || arg === '(' || arg === '!');
  const roots = firstExpression === -1 ? [...args] : args.slice(0, firstExpression);
  return roots.length > 0 ? roots : ['.'];
}

// Absolute and `~` targets resolve on their own; relative ones need a known cwd. Unknown → null (ask).
function resolveTarget(target: string, cwd: string | null, context: PolicyContext): string | null {
  if (cwd === null && !SELF_ROOTED.test(target)) return null;
  return resolveToolPath(target, { homeDir: context.homeDir, baseDir: cwd ?? context.workspaceDir });
}

function isOutside(context: PolicyContext): (resolved: string | null) => resolved is string {
  return (resolved): resolved is string => resolved !== null && !isInside(resolved, context.workspaceDir);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function decision(verdict: Decision['verdict'], ruleId: string, reason: string): Decision {
  return { verdict, reason, ruleId };
}
