// Pure path helpers for policy rules. POSIX only (v0.1 targets macOS / Linux).
// `node:path` is a pure module; resolve() never touches process.cwd() because the base is always absolute.
import path from 'node:path';

const posix = path.posix;

export interface PathBase {
  readonly homeDir: string;
  /** Absolute directory that relative paths resolve against. */
  readonly baseDir: string;
}

const HOME_PREFIXES = ['${HOME}', '$HOME'] as const;
const GLOB_CHARS = /[*?[\]{}]/;

/**
 * Turns a raw path from a tool input or shell word into an absolute, normalized path.
 * Expands `~`, `~user`, `$HOME` and `${HOME}`, resolves relative paths and `..`.
 * Returns null when the path cannot be known statically (empty, or another `$VAR`).
 */
export function resolveToolPath(raw: string, base: PathBase): string | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const expanded = expandHome(trimmed, base.homeDir);
  if (expanded.includes('$')) return null;
  return posix.resolve(base.baseDir, expanded);
}

function expandHome(raw: string, homeDir: string): string {
  if (raw === '~') return homeDir;
  if (raw.startsWith('~/')) return homeDir + raw.slice(1);
  if (raw.startsWith('~')) return posix.join(posix.dirname(homeDir), raw.slice(1));
  for (const prefix of HOME_PREFIXES) {
    if (raw === prefix || raw.startsWith(`${prefix}/`)) return homeDir + raw.slice(prefix.length);
  }
  return raw;
}

/** True when `child` is `parent` itself or somewhere below it. Both must be absolute. */
export function isInside(child: string, parent: string): boolean {
  const normalizedParent = posix.resolve(parent);
  const normalizedChild = posix.resolve(child);
  if (normalizedChild === normalizedParent) return true;
  const prefix = normalizedParent.endsWith('/') ? normalizedParent : `${normalizedParent}/`;
  return normalizedChild.startsWith(prefix);
}

/**
 * Case-insensitive variant for protected-path matching: macOS volumes are usually
 * case-insensitive, so `~/.SSH` is `~/.ssh`. Over-matching only ever denies more.
 */
export function isInsideIgnoringCase(child: string, parent: string): boolean {
  return isInside(child.toLowerCase(), parent.toLowerCase());
}

// The literal directory prefix of a glob pattern: "src/**/*.ts" → "src", "**/x" → "".
// A pattern without glob characters is its own root.
export function staticGlobRoot(pattern: string): string {
  const segments = pattern.split('/');
  const firstGlob = segments.findIndex((segment) => GLOB_CHARS.test(segment));
  if (firstGlob === -1) return pattern;
  const root = segments.slice(0, firstGlob).join('/');
  return root === '' && pattern.startsWith('/') ? '/' : root;
}

export function parentDir(absolutePath: string): string {
  return posix.dirname(absolutePath);
}

export function baseName(absolutePath: string): string {
  return posix.basename(absolutePath);
}

/** `~/x` form for human-readable reasons. */
export function displayPath(absolutePath: string, homeDir: string): string {
  if (absolutePath === homeDir) return '~';
  return isInside(absolutePath, homeDir) ? `~${absolutePath.slice(homeDir.length)}` : absolutePath;
}
