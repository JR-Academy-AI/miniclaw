// The resolved theme: tokens + detected terminal capabilities. Components ask it for colors by
// meaning (semantic / module) and for glyphs by name; they never see a hex value or a glyph literal.
import { gradientSpecAt, hexToRgb, inkColor, sgr, type ColorSpec, type Rgb, type SgrStyle } from './color.js';
import {
  detectAscii, detectColorDepth, detectReducedMotion, detectThemeMode,
  type ColorDepth, type TerminalInfo, type ThemeMode,
} from './detect.js';
import { loadTokens, type ColorName, type GlyphName, type ModuleName, type ReefTokens, type SemanticName } from './tokens.js';

export type BorderWeight = 'rounded' | 'heavy';

/** Same shape as Ink's (cli-boxes) custom borderStyle, so it can be passed straight to <Box>. */
export interface BoxStyle {
  readonly topLeft: string;
  readonly top: string;
  readonly topRight: string;
  readonly right: string;
  readonly bottomRight: string;
  readonly bottom: string;
  readonly bottomLeft: string;
  readonly left: string;
}

export interface Theme {
  readonly tokens: ReefTokens;
  readonly mode: ThemeMode;
  readonly depth: ColorDepth;
  readonly ascii: boolean;
  readonly reducedMotion: boolean;
  /** Full color spec of a palette or neutral token for the current mode. */
  spec(name: ColorName): ColorSpec;
  /** Ink color prop value for a token, or undefined when colors are off. */
  color(name: ColorName): string | undefined;
  semantic(name: SemanticName): string | undefined;
  module(name: ModuleName): string | undefined;
  /** Ink color for a point on the reef gradient (brand moments only). */
  gradient(t: number): string | undefined;
  gradientSpec(t: number): ColorSpec;
  /** The terminal background the art blends toward (dark ground or white). */
  groundRgb(): Rgb;
  glyph(name: GlyphName): string;
  border(weight: BorderWeight): BoxStyle;
  spinnerFrames(): readonly string[];
  /** Raw SGR for per-character art; plain text when colors are off. */
  paint(text: string, style: SgrStyle): string;
}

export interface ThemeOverrides {
  readonly mode?: ThemeMode;
  readonly depth?: ColorDepth;
  readonly ascii?: boolean;
  readonly reducedMotion?: boolean;
}

function toBoxStyle(entry: ReefTokens['border']['rounded']): BoxStyle {
  return {
    topLeft: entry.topLeft, top: entry.horizontal, topRight: entry.topRight, right: entry.vertical,
    bottomRight: entry.bottomRight, bottom: entry.horizontal, bottomLeft: entry.bottomLeft, left: entry.vertical,
  };
}

function specOf(tokens: ReefTokens, mode: ThemeMode, name: ColorName): ColorSpec {
  const entry = name in tokens.palette
    ? tokens.palette[name as keyof ReefTokens['palette']]
    : tokens.neutral[name as keyof ReefTokens['neutral']];
  return { rgb: hexToRgb(entry[mode]), ansi16: entry.ansi16 };
}

// The eyeBlack neutral is the dark ground the contrast figures are measured against (DESIGN §2.1).
function groundOf(tokens: ReefTokens, mode: ThemeMode): Rgb {
  return mode === 'dark' ? hexToRgb(tokens.neutral.eyeBlack.dark) : hexToRgb(tokens.neutral.eyeWhite.light);
}

export function buildTheme(tokens: ReefTokens, settings: Required<ThemeOverrides>): Theme {
  const { mode, depth, ascii } = settings;
  const spec = (name: ColorName): ColorSpec => specOf(tokens, mode, name);
  const stops = tokens.gradient.reef.map(spec);
  const gradientSpec = (t: number): ColorSpec => gradientSpecAt(stops, t);
  return {
    tokens, mode, depth, ascii, reducedMotion: settings.reducedMotion,
    spec,
    color: (name) => inkColor(spec(name), depth),
    semantic: (name) => inkColor(spec(tokens.semantic[name]), depth),
    module: (name) => inkColor(spec(tokens.module[name]), depth),
    gradient: (t) => inkColor(gradientSpec(t), depth),
    gradientSpec,
    groundRgb: () => groundOf(tokens, mode),
    glyph: (name) => (ascii ? tokens.glyph[name].ascii : tokens.glyph[name].unicode),
    border: (weight) => toBoxStyle(ascii ? tokens.border.ascii : tokens.border[weight]),
    spinnerFrames: () => (ascii ? tokens.spinner.asciiFrames : tokens.spinner.frames),
    paint: (text, style) => sgr(text, style, depth),
  };
}

/** Detects everything from the terminal, then applies explicit overrides (tests, flags). */
export function createTheme(terminal: TerminalInfo, overrides: ThemeOverrides = {}): Theme {
  return buildTheme(loadTokens(), {
    mode: overrides.mode ?? detectThemeMode(terminal.env),
    depth: overrides.depth ?? detectColorDepth(terminal),
    ascii: overrides.ascii ?? detectAscii(terminal.env),
    reducedMotion: overrides.reducedMotion ?? detectReducedMotion(terminal),
  });
}
