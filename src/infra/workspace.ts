import { mkdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export interface WorkspaceOptions {
  readonly homeDir: string; readonly userId: string; readonly explicitDir?: string; readonly miniclawHome?: string;
}
export interface Workspace { readonly cwd: string; readonly sessionId: string; readonly transcriptPath: string; readonly miniclawHome: string }

export async function createWorkspace(options: WorkspaceOptions): Promise<Workspace> {
  if (!/^[A-Za-z0-9_.-]+$/.test(options.userId) || ['.', '..'].includes(options.userId)) {
    throw new Error('Invalid user ID: use letters, digits, dots, underscores or hyphens.');
  }
  const explicit = options.explicitDir ? await realpath(path.resolve(options.explicitDir)) : null;
  if (explicit && !(await stat(explicit)).isDirectory()) throw new Error('The selected workspace must be a directory.');
  const requestedHome = options.miniclawHome ? path.resolve(options.miniclawHome)
    : path.join(await realpath(options.homeDir), '.miniclaw');
  await mkdir(requestedHome, { recursive: true, mode: 0o700 });
  const miniclawHome = await realpath(requestedHome);
  const userRoot = path.join(miniclawHome, 'users', options.userId);
  const sessionId = randomUUID();
  const runRoot = path.join(userRoot, 'runs', sessionId);
  await mkdir(runRoot, { recursive: true, mode: 0o700 });
  let cwd: string;
  if (explicit) {
    cwd = explicit;
  } else {
    const temporary = path.join(userRoot, 'workspace', 'tmp', sessionId);
    await mkdir(temporary, { recursive: true, mode: 0o700 });
    cwd = await realpath(temporary);
  }
  return { cwd, sessionId, transcriptPath: path.join(runRoot, 'transcript.jsonl'), miniclawHome };
}
