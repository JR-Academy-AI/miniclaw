import { lstat, readdir, realpath, readlink } from 'node:fs/promises';
import path from 'node:path';
import type { ToolRequest } from '../core/tool-gate.js';
import type { Decision, PolicyContext } from '../core/policy/types.js';
import { requestPaths } from '../core/policy/decide.js';
import { checkHardFloorPath, checkSearchScope } from '../core/policy/hard-floor.js';

const blocked = (reason: string): Decision => ({ verdict: 'deny', ruleId: 'hard-floor.canonical', reason });

export function createPathInspector(context: PolicyContext): (request: ToolRequest) => Promise<Decision | null> {
  return async request => {
    try {
      const canonicalContext = { homeDir: await canonicalTarget(context.homeDir),
        miniclawHome: await canonicalTarget(context.miniclawHome), workspaceDir: await canonicalTarget(context.workspaceDir) };
      for (const candidate of requestPaths(request, context)) {
        const canonical = await canonicalTarget(candidate);
        const denial = checkHardFloorPath(canonical, canonicalContext);
        if (denial) return denial;
        const result = await inspectDirectory(canonical, canonicalContext);
        if (result) return result;
      }
      return null;
    } catch (error) {
      return blocked(`Cannot safely inspect this path: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
}

async function canonicalTarget(candidate: string): Promise<string> {
  try { return await realpath(candidate); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const target = await danglingLink(candidate);
    if (target) return canonicalTarget(target);
    const parent = path.dirname(candidate);
    if (parent === candidate) throw error;
    return path.join(await canonicalTarget(parent), path.basename(candidate));
  }
}

async function danglingLink(candidate: string): Promise<string | null> {
  try {
    if ((await lstat(candidate)).isSymbolicLink()) return path.resolve(path.dirname(candidate), await readlink(candidate));
    return null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function inspectDirectory(candidate: string, context: PolicyContext): Promise<Decision | null> {
  let info;
  try { info = await lstat(candidate); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  if (!info.isDirectory()) return null;
  const scope = checkSearchScope(candidate, context);
  if (scope) return scope;
  return scanTree(candidate, context);
}

async function scanTree(root: string, context: PolicyContext): Promise<Decision | null> {
  const pending = [root];
  let visited = 0;
  while (pending.length) {
    const directory = pending.pop()!;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (++visited > 5000) return blocked('Directory exceeds the v0.1 safe inspection limit; select a narrower path.');
      const candidate = path.join(directory, entry.name);
      const denial = checkHardFloorPath(candidate, context);
      if (denial) return denial;
      if (entry.isSymbolicLink()) return blocked('Recursive operations through symbolic links require a narrower path.');
      if (entry.isDirectory()) pending.push(candidate);
    }
  }
  return null;
}
