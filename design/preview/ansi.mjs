// Terminal painting helpers for the design preview: color-depth detection,
// token → SGR escape codes, gradients and CJK-aware display width.
// Everything color-related reads from tokens.json so the preview never drifts from the spec.
import { readFileSync } from 'node:fs';

export const tokens = JSON.parse(readFileSync(new URL('../tokens.json', import.meta.url), 'utf8'));

const ESC = '\x1b[';
const ANSI16_FOREGROUND = {
  black: 30, red: 31, green: 32, yellow: 33, blue: 34, magenta: 35, cyan: 36, white: 37,
  brightBlack: 90, brightRed: 91, brightGreen: 92, brightYellow: 93,
  brightBlue: 94, brightMagenta: 95, brightCyan: 96, brightWhite: 97,
};
const XTERM_CUBE_LEVELS = [0, 95, 135, 175, 215, 255];

export function detectColorDepth(env = process.env, stream = process.stdout) {
  if (env.NO_COLOR) return 'none';
  if (!stream.isTTY && !env.FORCE_COLOR) return 'none';
  if (/truecolor|24bit/i.test(env.COLORTERM ?? '')) return 'truecolor';
  if (/256/.test(env.TERM ?? '')) return '256';
  return '16';
}

// COLORFGBG is "fg;bg" — a bg of 7 or 15 means a light terminal. Defaults to dark.
export function detectTheme(env = process.env) {
  if (env.MINICLAW_THEME === 'light' || env.MINICLAW_THEME === 'dark') return env.MINICLAW_THEME;
  const background = Number((env.COLORFGBG ?? '').split(';').pop());
  return background === 7 || background === 15 ? 'light' : 'dark';
}

function hexToRgb(hex) {
  return [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
}

// A color spec carries every representation so each depth can pick its own.
function toSpec(hex, ansi16) {
  return { rgb: hexToRgb(hex), ansi16 };
}

export function color(context, tokenName) {
  const entry = tokens.palette[tokenName] ?? tokens.neutral[tokenName];
  if (!entry) throw new Error(`Unknown color token: ${tokenName}`);
  return toSpec(entry[context.theme], entry.ansi16);
}

function nearestCubeIndex(channel) {
  let best = 0;
  XTERM_CUBE_LEVELS.forEach((level, index) => {
    if (Math.abs(level - channel) < Math.abs(XTERM_CUBE_LEVELS[best] - channel)) best = index;
  });
  return best;
}

function rgbTo256([red, green, blue]) {
  const [r, g, b] = [red, green, blue].map(nearestCubeIndex);
  return 16 + 36 * r + 6 * g + b;
}

function colorCode(context, spec, layer) {
  if (!spec || context.depth === 'none') return null;
  const base = layer === 'background' ? 48 : 38;
  if (context.depth === 'truecolor') return `${base};2;${spec.rgb.join(';')}`;
  if (context.depth === '256') return `${base};5;${rgbTo256(spec.rgb)}`;
  if (!spec.ansi16) return null;
  const foregroundCode = ANSI16_FOREGROUND[spec.ansi16];
  return String(layer === 'background' ? foregroundCode + 10 : foregroundCode);
}

// style: { foreground, background, bold, dim, italic, underline } — colors are specs or token names.
export function paint(context, text, style = {}) {
  const resolve = (value) => (typeof value === 'string' ? color(context, value) : value);
  const codes = [
    style.bold && '1', style.dim && '2', style.italic && '3', style.underline && '4',
    colorCode(context, resolve(style.foreground), 'foreground'),
    colorCode(context, resolve(style.background), 'background'),
  ].filter(Boolean);
  // NO_COLOR still allows bold/italic/underline, which is exactly what remains in `codes`.
  if (codes.length === 0) return text;
  return `${ESC}${codes.join(';')}m${text}${ESC}0m`;
}

function mixRgb(from, to, amount) {
  return from.map((channel, index) => Math.round(channel + (to[index] - channel) * amount));
}

// t in [0, 1] along the named gradient; 16-color terminals snap to the nearest stop.
export function gradientAt(context, t, gradientName = 'reef') {
  const stops = tokens.gradient[gradientName].map((name) => color(context, name));
  const clamped = Math.min(Math.max(t, 0), 1) * (stops.length - 1);
  const index = Math.min(Math.floor(clamped), stops.length - 2);
  const local = clamped - index;
  const nearest = stops[Math.round(clamped)];
  return { rgb: mixRgb(stops[index].rgb, stops[index + 1].rgb, local), ansi16: nearest.ansi16 };
}

// Only truecolor/256 can show the blend; 16-color keeps the original ansi16 slot.
export function blend(spec, targetRgb, amount) {
  return { ...spec, rgb: mixRgb(spec.rgb, targetRgb, amount) };
}

export function lighten(spec, amount) {
  return blend(spec, [255, 255, 255], amount);
}

export function paintGradient(context, text, { start = 0, end = 1, bold = false } = {}) {
  const characters = [...text];
  const span = Math.max(characters.length - 1, 1);
  return characters
    .map((character, index) => {
      if (character === ' ') return character;
      const foreground = gradientAt(context, start + ((end - start) * index) / span);
      return paint(context, character, { foreground, bold });
    })
    .join('');
}

const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;
const WIDE_RANGES = [
  [0x1100, 0x115f], [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff],
  [0xa000, 0xa4cf], [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe30, 0xfe4f], [0xff00, 0xff60],
  [0xffe0, 0xffe6], [0x1f300, 0x1faff],
];

function characterWidth(codePoint) {
  return WIDE_RANGES.some(([low, high]) => codePoint >= low && codePoint <= high) ? 2 : 1;
}

export function displayWidth(text) {
  return [...text.replace(ANSI_PATTERN, '')]
    .reduce((width, character) => width + characterWidth(character.codePointAt(0)), 0);
}

export function padDisplayEnd(text, width) {
  return text + ' '.repeat(Math.max(width - displayWidth(text), 0));
}

export function glyph(context, name) {
  const entry = tokens.glyph[name];
  return context.ascii ? entry.ascii : entry.unicode;
}

export function borderSet(context, weight = 'rounded') {
  return context.ascii ? tokens.border.ascii : tokens.border[weight];
}

export function createContext(overrides = {}) {
  return {
    depth: detectColorDepth(),
    theme: detectTheme(),
    ascii: process.env.MINICLAW_ASCII === '1',
    width: process.stdout.columns || 100,
    ...overrides,
  };
}
