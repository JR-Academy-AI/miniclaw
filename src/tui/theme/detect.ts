// Terminal capability detection (DESIGN §9). Pure functions of the environment so tests
// and the composition root can pass any env; nothing here reads process.* directly.

export type ColorDepth = 'none' | '16' | '256' | 'truecolor';
export type ThemeMode = 'dark' | 'light';
export type Env = Readonly<Record<string, string | undefined>>;

export interface TerminalInfo {
  readonly env: Env;
  /** Whether stdout is an interactive terminal. */
  readonly isTTY: boolean;
}

export function detectColorDepth({ env, isTTY }: TerminalInfo): ColorDepth {
  if (env.NO_COLOR !== undefined) return 'none';
  if (!isTTY && !env.FORCE_COLOR) return 'none';
  if (env.FORCE_COLOR === '0') return 'none';
  if (/truecolor|24bit/i.test(env.COLORTERM ?? '')) return 'truecolor';
  if (env.FORCE_COLOR === '3') return 'truecolor';
  if (/256/.test(env.TERM ?? '') || env.FORCE_COLOR === '2') return '256';
  return '16';
}

/** MINICLAW_THEME wins; otherwise COLORFGBG "fg;bg" with bg 7 or 15 means light; default dark. */
export function detectThemeMode(env: Env): ThemeMode {
  if (env.MINICLAW_THEME === 'light' || env.MINICLAW_THEME === 'dark') return env.MINICLAW_THEME;
  const background = Number((env.COLORFGBG ?? '').split(';').pop());
  return background === 7 || background === 15 ? 'light' : 'dark';
}

/**
 * ASCII glyphs when MINICLAW_ASCII=1 or the locale is explicitly not UTF-8 (e.g. LANG=C).
 * No locale variable at all is treated as UTF-8: most modern terminals are, and we cannot tell.
 */
export function detectAscii(env: Env): boolean {
  if (env.MINICLAW_ASCII === '1') return true;
  const locale = env.LC_ALL || env.LC_CTYPE || env.LANG;
  if (!locale) return false;
  return !/utf-?8/i.test(locale);
}

/** Animations show their last frame when piped, in CI, or with MINICLAW_REDUCED_MOTION=1. */
export function detectReducedMotion({ env, isTTY }: TerminalInfo): boolean {
  if (!isTTY) return true;
  if (env.CI) return true;
  return env.MINICLAW_REDUCED_MOTION === '1';
}
