// Hard floor (HARNESS §6.4, v0.1 subset): paths no tool call may touch, whatever anyone approves.
// Every rule here denies; nothing in this file ever returns allow or ask.
import type { Decision, PolicyContext } from './types.js';
import { baseName, displayPath, isInside, isInsideIgnoringCase } from './path-utils.js';

interface ProtectedRootSpec {
  readonly ruleId: string;
  readonly label: string;
  /** Relative to the user's home directory, or absolute when it starts with "/". */
  readonly location: string;
}

export interface ProtectedRoot {
  readonly ruleId: string;
  readonly label: string;
  readonly path: string;
}

const APP_SUPPORT = 'Library/Application Support';

const PROTECTED_ROOT_SPECS: readonly ProtectedRootSpec[] = [
  { ruleId: 'hard-floor.ssh', label: 'SSH keys', location: '.ssh' },
  { ruleId: 'hard-floor.aws', label: 'AWS credentials', location: '.aws' },
  { ruleId: 'hard-floor.gnupg', label: 'GPG keys', location: '.gnupg' },
  { ruleId: 'hard-floor.gcloud', label: 'Google Cloud credentials', location: '.config/gcloud' },
  { ruleId: 'hard-floor.keychain', label: 'the keychain', location: 'Library/Keychains' },
  { ruleId: 'hard-floor.keychain', label: 'the keychain', location: '/Library/Keychains' },
  ...[
    `${APP_SUPPORT}/Google/Chrome`,
    `${APP_SUPPORT}/Google/Chrome Beta`,
    `${APP_SUPPORT}/Google/Chrome Canary`,
    `${APP_SUPPORT}/Chromium`,
    `${APP_SUPPORT}/BraveSoftware`,
    `${APP_SUPPORT}/Microsoft Edge`,
    `${APP_SUPPORT}/Arc`,
    `${APP_SUPPORT}/Vivaldi`,
    `${APP_SUPPORT}/Firefox`,
    'Library/Safari',
    '.config/google-chrome',
    '.config/chromium',
    '.config/BraveSoftware',
    '.config/microsoft-edge',
    '.mozilla',
  ].map((location) => ({ ruleId: 'hard-floor.browser-profile', label: 'a browser profile', location })),
];

const ENV_FILE = /^\.env/i;

export function protectedRoots(homeDir: string): ProtectedRoot[] {
  return PROTECTED_ROOT_SPECS.map((spec) => ({
    ruleId: spec.ruleId,
    label: spec.label,
    path: spec.location.startsWith('/') ? spec.location : `${homeDir}/${spec.location}`,
  }));
}

/** Deny when an absolute, normalized path touches anything on the hard floor. */
export function checkHardFloorPath(absolutePath: string, context: PolicyContext): Decision | null {
  const root = protectedRoots(context.homeDir).find((candidate) =>
    isInsideIgnoringCase(absolutePath, candidate.path),
  );
  if (root) return deny(root.ruleId, `touches ${root.label} (${displayPath(root.path, context.homeDir)})`);
  if (absolutePath.split('/').some(segment => ENV_FILE.test(segment))) {
    return deny('hard-floor.env-file', `touches an environment file (${baseName(absolutePath)})`);
  }
  if (isMiniclawState(absolutePath, context)) {
    const where = displayPath(absolutePath, context.homeDir);
    return deny('hard-floor.miniclaw', `touches miniclaw's own data (${where}) outside this session's workspace`);
  }
  return null;
}

/**
 * Deny a recursive search (Grep / Glob, which run without asking) whose root contains protected data,
 * e.g. Grep over `~` would read `~/.ssh`. The session workspace itself is always searchable.
 */
export function checkSearchScope(searchRoot: string, context: PolicyContext): Decision | null {
  if (searchRoot === context.workspaceDir) return null;
  const covered = [
    ...protectedRoots(context.homeDir),
    { ruleId: 'hard-floor.miniclaw', label: "miniclaw's own data", path: context.miniclawHome },
  ].find((root) => isInsideIgnoringCase(root.path, searchRoot));
  if (!covered) return null;
  const where = displayPath(searchRoot, context.homeDir);
  const protectedPath = displayPath(covered.path, context.homeDir);
  return deny(
    'hard-floor.search-scope',
    `searches ${where}, which contains ${covered.label} (${protectedPath}); search a narrower folder`,
  );
}

// Everything under miniclawHome is off-limits except the session workspace, and the exception only
// counts when the workspace really sits inside miniclawHome (`miniclaw ~` must not unlock ~/.miniclaw).
function isMiniclawState(absolutePath: string, context: PolicyContext): boolean {
  if (!isInsideIgnoringCase(absolutePath, context.miniclawHome)) return false;
  const workspaceIsInsideHome =
    context.workspaceDir !== context.miniclawHome && isInside(context.workspaceDir, context.miniclawHome);
  return !(workspaceIsInsideHome && isInside(absolutePath, context.workspaceDir));
}

function deny(ruleId: string, reason: string): Decision {
  return { verdict: 'deny', reason, ruleId };
}
