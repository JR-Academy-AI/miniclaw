// Color math ported from the design prototype: hex → RGB, the reef gradient, 256-color cube
// mapping, and the two outputs the TUI needs: Ink color strings and raw SGR for gradient art.
import type { ColorDepth } from './detect.js';

export type Rgb = readonly [number, number, number];

/** Every representation of one color, so each depth can pick its own (ansi16 null = no 16-color value). */
export interface ColorSpec {
  readonly rgb: Rgb;
  readonly ansi16: string | null;
}

const ESC = '\x1b[';
const XTERM_CUBE_LEVELS = [0, 95, 135, 175, 215, 255] as const;
const ANSI16_SGR: Readonly<Record<string, number>> = {
  black: 30, red: 31, green: 32, yellow: 33, blue: 34, magenta: 35, cyan: 36, white: 37,
  brightBlack: 90, brightRed: 91, brightGreen: 92, brightYellow: 93,
  brightBlue: 94, brightMagenta: 95, brightCyan: 96, brightWhite: 97,
};

export function hexToRgb(hex: string): Rgb {
  const channel = (index: number): number => parseInt(hex.slice(index, index + 2), 16);
  return [channel(1), channel(3), channel(5)];
}

export function mixRgb(from: Rgb, to: Rgb, amount: number): Rgb {
  const mix = (index: 0 | 1 | 2): number => Math.round(from[index] + (to[index] - from[index]) * amount);
  return [mix(0), mix(1), mix(2)];
}

function nearestCubeIndex(channel: number): number {
  let best = 0;
  XTERM_CUBE_LEVELS.forEach((level, index) => {
    if (Math.abs(level - channel) < Math.abs(XTERM_CUBE_LEVELS[best]! - channel)) best = index;
  });
  return best;
}

export function rgbTo256([red, green, blue]: Rgb): number {
  return 16 + 36 * nearestCubeIndex(red) + 6 * nearestCubeIndex(green) + nearestCubeIndex(blue);
}

/** t in [0, 1] along the stops; 16-color terminals snap to the nearest stop's ansi16 slot. */
export function gradientSpecAt(stops: readonly ColorSpec[], t: number): ColorSpec {
  const clamped = Math.min(Math.max(t, 0), 1) * (stops.length - 1);
  const index = Math.min(Math.floor(clamped), stops.length - 2);
  const nearest = stops[Math.round(clamped)]!;
  const rgb = mixRgb(stops[index]!.rgb, stops[index + 1]!.rgb, clamped - index);
  return { rgb, ansi16: nearest.ansi16 };
}

/** Only truecolor/256 can show the blend; 16-color keeps the original ansi16 slot. */
export function blendSpec(spec: ColorSpec, target: Rgb, amount: number): ColorSpec {
  return { ...spec, rgb: mixRgb(spec.rgb, target, amount) };
}

// Ink (chalk) spells bright colors "redBright"; tokens.json uses "brightRed".
function ansi16ToInkName(name: string): string {
  if (!name.startsWith('bright')) return name;
  const base = name.slice('bright'.length);
  return `${base.charAt(0).toLowerCase()}${base.slice(1)}Bright`;
}

function toHex(rgb: Rgb): string {
  return `#${rgb.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

/** The value to pass to Ink's color / backgroundColor props, or undefined for "no color". */
export function inkColor(spec: ColorSpec, depth: ColorDepth): string | undefined {
  if (depth === 'none') return undefined;
  if (depth === 'truecolor') return toHex(spec.rgb);
  if (depth === '256') return `ansi256(${rgbTo256(spec.rgb)})`;
  return spec.ansi16 ? ansi16ToInkName(spec.ansi16) : undefined;
}

export type Layer = 'foreground' | 'background';

/** SGR parameter for one color, or null when the depth has no representation for it. */
export function sgrColor(spec: ColorSpec, depth: ColorDepth, layer: Layer): string | null {
  if (depth === 'none') return null;
  const base = layer === 'background' ? 48 : 38;
  if (depth === 'truecolor') return `${base};2;${spec.rgb.join(';')}`;
  if (depth === '256') return `${base};5;${rgbTo256(spec.rgb)}`;
  const code = spec.ansi16 ? ANSI16_SGR[spec.ansi16] : undefined;
  if (code === undefined) return null;
  return String(layer === 'background' ? code + 10 : code);
}

export interface SgrStyle {
  readonly foreground?: ColorSpec;
  readonly background?: ColorSpec;
  readonly bold?: boolean;
}

/** Wraps text in one SGR sequence. Used only for per-character brand art that Ink props cannot express. */
export function sgr(text: string, style: SgrStyle, depth: ColorDepth): string {
  const codes = [
    style.bold ? '1' : null,
    style.foreground ? sgrColor(style.foreground, depth, 'foreground') : null,
    style.background ? sgrColor(style.background, depth, 'background') : null,
  ].filter((code): code is string => code !== null);
  if (codes.length === 0) return text;
  return `${ESC}${codes.join(';')}m${text}${ESC}0m`;
}
