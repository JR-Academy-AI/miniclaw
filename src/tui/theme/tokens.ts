// Loads design/tokens.json (the Reef single source of truth) at runtime and validates the
// names the TUI relies on, so a renamed token fails at startup instead of rendering blank.
import { readFileSync } from 'node:fs';

export const PALETTE_NAMES = ['coral', 'tangerine', 'sun', 'kelp', 'lagoon', 'tide', 'orchid', 'anemone'] as const;
export const NEUTRAL_NAMES = ['muted', 'subtle', 'border', 'surface', 'surfaceStrong', 'eyeWhite', 'eyeBlack'] as const;
export const SEMANTIC_NAMES = ['success', 'warning', 'error', 'info', 'running', 'permission', 'scheduled'] as const;
export const MODULE_NAMES = ['chat', 'tasks', 'schedules', 'skills', 'models', 'logs'] as const;
export const GLYPH_NAMES = [
  'running', 'success', 'error', 'warning', 'permission', 'scheduled', 'paused', 'queued', 'retry', 'cancelled',
  'prompt', 'result', 'collapsed', 'expanded', 'thread', 'default', 'sparkle', 'progressFilled', 'progressEmpty',
] as const;

export type PaletteName = (typeof PALETTE_NAMES)[number];
export type NeutralName = (typeof NEUTRAL_NAMES)[number];
export type ColorName = PaletteName | NeutralName;
export type SemanticName = (typeof SEMANTIC_NAMES)[number];
export type ModuleName = (typeof MODULE_NAMES)[number];
export type GlyphName = (typeof GLYPH_NAMES)[number];

export interface ColorEntry {
  readonly dark: string;
  readonly light: string;
  readonly ansi16: string | null;
}

export interface BorderEntry {
  readonly topLeft: string;
  readonly topRight: string;
  readonly bottomLeft: string;
  readonly bottomRight: string;
  readonly horizontal: string;
  readonly vertical: string;
}

export interface WelcomeMotion {
  readonly logoRevealMs: number;
  readonly logoShineMs: number;
  readonly crabSnipAtMs: readonly number[];
  readonly crabSnipHoldMs: number;
  readonly checkStartMs: number;
  readonly checkStaggerMs: number;
  readonly checkResolveMs: number;
  readonly maxTotalMs: number;
}

export interface ReefTokens {
  readonly version: string;
  readonly palette: Readonly<Record<PaletteName, ColorEntry>>;
  readonly neutral: Readonly<Record<NeutralName, ColorEntry>>;
  readonly gradient: { readonly reef: readonly PaletteName[] };
  readonly semantic: Readonly<Record<SemanticName, ColorName>>;
  readonly module: Readonly<Record<ModuleName, ColorName>>;
  readonly glyph: Readonly<Record<GlyphName, { readonly unicode: string; readonly ascii: string }>>;
  readonly border: { readonly rounded: BorderEntry; readonly heavy: BorderEntry; readonly ascii: BorderEntry };
  readonly spinner: { readonly frames: readonly string[]; readonly asciiFrames: readonly string[]; readonly intervalMs: number };
  readonly motion: { readonly frameIntervalMs: number; readonly shimmerIntervalMs: number; readonly welcome: WelcomeMotion };
  readonly layout: {
    readonly breakpoints: { readonly compact: number; readonly regular: number; readonly wide: number };
    readonly welcomeCrabMinWidth: number;
    readonly gutter: number;
  };
}

// src/tui/theme/ and dist/tui/theme/ both sit three levels below the package root.
const TOKENS_URL = new URL('../../../design/tokens.json', import.meta.url);

function requireKeys(section: unknown, names: readonly string[], label: string): void {
  if (typeof section !== 'object' || section === null) throw new Error(`design/tokens.json: missing "${label}"`);
  const missing = names.filter((name) => !(name in section));
  if (missing.length > 0) throw new Error(`design/tokens.json: "${label}" is missing ${missing.join(', ')}`);
}

/** Fails fast when tokens.json no longer has a name the TUI uses (tokens.json major bump). */
export function validateTokens(raw: unknown): ReefTokens {
  const candidate = raw as Partial<Record<keyof ReefTokens, unknown>>;
  requireKeys(candidate.palette, PALETTE_NAMES, 'palette');
  requireKeys(candidate.neutral, NEUTRAL_NAMES, 'neutral');
  requireKeys(candidate.semantic, SEMANTIC_NAMES, 'semantic');
  requireKeys(candidate.module, MODULE_NAMES, 'module');
  requireKeys(candidate.glyph, GLYPH_NAMES, 'glyph');
  requireKeys(candidate.border, ['rounded', 'heavy', 'ascii'], 'border');
  requireKeys(candidate.spinner, ['frames', 'asciiFrames', 'intervalMs'], 'spinner');
  requireKeys(candidate.motion, ['frameIntervalMs', 'shimmerIntervalMs', 'welcome'], 'motion');
  requireKeys(candidate.layout, ['breakpoints', 'welcomeCrabMinWidth', 'gutter'], 'layout');
  requireKeys(candidate.gradient, ['reef'], 'gradient');
  return raw as ReefTokens;
}

let cached: ReefTokens | null = null;

export function loadTokens(): ReefTokens {
  if (cached) return cached;
  cached = validateTokens(JSON.parse(readFileSync(TOKENS_URL, 'utf8')));
  return cached;
}
