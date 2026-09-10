import type { ToolRequest } from '../tool-gate.js';
import type { Decision, PolicyContext } from './types.js';
import { checkHardFloorPath, checkSearchScope } from './hard-floor.js';
import { resolveToolPath, staticGlobRoot } from './path-utils.js';
import { checkShellDelete, shellCommandPaths } from './shell-rules.js';
import { parseShell } from './shell-words.js';

const FILE_TOOLS = new Set(['Read', 'Write', 'Edit', 'NotebookEdit', 'Grep', 'Glob']);
const READ_TOOLS = new Set(['Read', 'Grep', 'Glob']);
const SIMPLE_COMMANDS = new Set(['echo', 'printf', 'pwd', 'ls', 'cat', 'head', 'tail', 'wc',
  'mkdir', 'touch', 'cp', 'mv', 'tee', 'sort', 'uniq', 'cut', 'tr', 'diff']);
const PATH_KEYS = ['file_path', 'path', 'notebook_path'] as const;
const denied = (reason: string, ruleId = 'hard-floor.uninspectable'): Decision =>
  ({ verdict: 'deny', reason, ruleId });

export function requestPaths(request: ToolRequest, context: PolicyContext): string[] {
  if (request.tool === 'Bash' && typeof request.input.command === 'string') {
    return shellCommandPaths(request.input.command, context);
  }
  const raw = PATH_KEYS.flatMap(key => typeof request.input[key] === 'string' ? [request.input[key]] : []);
  if (request.tool === 'Glob' || request.tool === 'Grep') raw.push(String(request.input.path ?? '.'));
  if (request.tool === 'Glob' && typeof request.input.pattern === 'string') {
    raw.push(staticGlobRoot(request.input.pattern) || '.');
  }
  return raw.flatMap(value => {
    const result = resolveToolPath(value, { homeDir: context.homeDir, baseDir: context.workspaceDir });
    return result === null ? [] : [result];
  });
}

export function decide(request: ToolRequest, context: PolicyContext): Decision {
  const paths = requestPaths(request, context);
  for (const path of paths) {
    const hardFloor = checkHardFloorPath(path, context);
    if (hardFloor) return hardFloor;
  }
  if (request.tool === 'Bash') return decideShell(request, context);
  if (FILE_TOOLS.has(request.tool) && paths.length === 0) return denied('The file path cannot be resolved.');
  if (request.tool === 'Grep' || request.tool === 'Glob') {
    for (const path of paths) {
      const scope = checkSearchScope(path, context);
      if (scope) return scope;
    }
  }
  if (READ_TOOLS.has(request.tool)) return { verdict: 'allow', ruleId: 'readonly', reason: 'Read-only file operation.' };
  return { verdict: 'ask', ruleId: 'approval.required', reason: 'This action requires your approval.' };
}

function decideShell(request: ToolRequest, context: PolicyContext): Decision {
  const command = request.input.command;
  if (typeof command !== 'string' || !command.trim()) return denied('A shell command is required.');
  const deletion = checkShellDelete(command, context);
  if (deletion) return deletion;
  if (/[$`*?[\]{}\n\\]/.test(command)) return denied('Dynamic shell expansion is unavailable in v0.1.');
  const segments = parseShell(command);
  if (segments.some(segment => !SIMPLE_COMMANDS.has(segment.words[0] ?? ''))) {
    return denied('This shell executable cannot be safely inspected in v0.1.');
  }
  return { verdict: 'ask', ruleId: 'approval.shell', reason: 'Shell commands require your approval.' };
}
