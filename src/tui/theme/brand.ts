// Brand art for the welcome screen (DESIGN §8.1): the ANSI Shadow MINICLAW wordmark and the
// 16×12 pixel crab. This is artwork data, not UI glyphs; colors still come from the theme.
// Frame functions are pure in `elapsed`, so animated and static rendering share one path.
import { blendSpec, mixRgb, type ColorSpec } from './color.js';
import type { Theme } from './theme.js';
import type { ColorName } from './tokens.js';

const LOGO_LETTERS: Readonly<Record<string, readonly string[]>> = {
  M: ['███╗   ███╗', '████╗ ████║', '██╔████╔██║', '██║╚██╔╝██║', '██║ ╚═╝ ██║', '╚═╝     ╚═╝'],
  I: ['██╗', '██║', '██║', '██║', '██║', '╚═╝'],
  N: ['███╗   ██╗', '████╗  ██║', '██╔██╗ ██║', '██║╚██╗██║', '██║ ╚████║', '╚═╝  ╚═══╝'],
  C: [' ██████╗', '██╔════╝', '██║     ', '██║     ', '╚██████╗', ' ╚═════╝'],
  L: ['██╗     ', '██║     ', '██║     ', '██║     ', '███████╗', '╚══════╝'],
  A: [' █████╗ ', '██╔══██╗', '███████║', '██╔══██║', '██║  ██║', '╚═╝  ╚═╝'],
  W: ['██╗    ██╗', '██║    ██║', '██║ █╗ ██║', '██║███╗██║', '╚███╔███╔╝', ' ╚══╝╚══╝ '],
};
const LOGO_ROWS = [0, 1, 2, 3, 4, 5].map((row) => [...'MINICLAW'].map((letter) => LOGO_LETTERS[letter]![row]).join(''));
export const LOGO_WIDTH = [...LOGO_ROWS[0]!].length;

// R shell, D highlight, W/K eyes. Two pixel rows become one character row via half blocks.
const CRAB_BODY = [
  '...R..W..W..R...', '...R..K..K..R...', '..RRRRRRRRRRRR..', '.RRRRRRRRRRRRRR.',
  '.RRDRRRRRRRRDRR.', '..RRRRRRRRRRRR..', '.R.R.R....R.R.R.', 'R.R.R......R.R.R',
];
const CRAB_CLAWS_OPEN = ['..R.R......R.R..', '.RR.RR....RR.RR.', '.RRRRR....RRRRR.', '..RRR......RRR..'];
const CRAB_CLAWS_CLOSED = ['...RR......RR...', '..RRRR....RRRR..', '.RRRRR....RRRRR.', '..RRR......RRR..'];
const CRAB_PIXELS: Readonly<Record<string, ColorName>> = { R: 'coral', D: 'tangerine', W: 'eyeWhite', K: 'eyeBlack' };
export const CRAB_WIDTH = 16;
const HALF_BLOCK = { upper: '▀', lower: '▄', full: '█' } as const;

/** The one-line compact wordmark (DESIGN §5.2): mascot + gradient name. */
export const MASCOT = { unicode: '(\\/)(°,,°)(\\/)', ascii: '(\\/)(o,,o)(\\/)' } as const;
export const WORDMARK = 'miniclaw';

const easeOutCubic = (progress: number): number => 1 - (1 - Math.min(Math.max(progress, 0), 1)) ** 3;

function pixelCell(theme: Theme, top: ColorName | undefined, bottom: ColorName | undefined): string {
  if (!top && !bottom) return ' ';
  if (!top) return theme.paint(HALF_BLOCK.lower, { foreground: theme.spec(bottom!) });
  if (!bottom) return theme.paint(HALF_BLOCK.upper, { foreground: theme.spec(top) });
  // 16-color and no-color have no reliable background, so two-tone cells collapse to a full block.
  if (top === bottom || theme.depth === 'none' || theme.depth === '16') {
    return theme.paint(HALF_BLOCK.full, { foreground: theme.spec(top) });
  }
  return theme.paint(HALF_BLOCK.upper, { foreground: theme.spec(top), background: theme.spec(bottom) });
}

export function crabLines(theme: Theme, snipping: boolean): string[] {
  const pixels = [...(snipping ? CRAB_CLAWS_CLOSED : CRAB_CLAWS_OPEN), ...CRAB_BODY];
  const lines: string[] = [];
  for (let row = 0; row < pixels.length; row += 2) {
    const topRow = [...pixels[row]!];
    const bottomRow = [...pixels[row + 1]!];
    lines.push(topRow.map((pixel, column) => pixelCell(theme, CRAB_PIXELS[pixel], CRAB_PIXELS[bottomRow[column]!])).join(''));
  }
  return lines;
}

interface LogoCell {
  readonly column: number;
  readonly row: number;
  readonly character: string;
  readonly shinePosition: number | null;
}

function logoCellSpec(theme: Theme, cell: LogoCell): ColorSpec {
  let spec = theme.gradientSpec((cell.column + cell.row * 1.5) / (LOGO_WIDTH + 9));
  // Shadow strokes (╗║═…) sit back in depth; solid blocks carry the full color.
  if (cell.character !== HALF_BLOCK.full) spec = blendSpec(spec, theme.groundRgb(), 0.4);
  if (cell.shinePosition === null) return spec;
  const distance = Math.abs((cell.column - cell.row * 2) / LOGO_WIDTH - cell.shinePosition);
  if (distance >= 0.08) return spec;
  return { ...spec, rgb: mixRgb(spec.rgb, [255, 255, 255], (1 - distance / 0.08) * 0.75) };
}

export function logoLines(theme: Theme, elapsed: number): string[] {
  const timing = theme.tokens.motion.welcome;
  const reveal = easeOutCubic(elapsed / timing.logoRevealMs);
  const shineProgress = (elapsed - timing.logoRevealMs * 0.6) / timing.logoShineMs;
  const shinePosition = shineProgress >= 0 && shineProgress <= 1 ? -0.2 + 1.4 * shineProgress : null;
  return LOGO_ROWS.map((line, row) => [...line].map((character, column) => {
    const visible = (column + row * 2) / (LOGO_WIDTH + 10) <= reveal;
    if (character === ' ' || !visible) return ' ';
    const foreground = logoCellSpec(theme, { column, row, character, shinePosition });
    return theme.paint(character, { foreground, bold: character === HALF_BLOCK.full });
  }).join(''));
}

export function isCrabSnipping(theme: Theme, elapsed: number): boolean {
  const timing = theme.tokens.motion.welcome;
  return timing.crabSnipAtMs.some((at) => elapsed >= at && elapsed < at + timing.crabSnipHoldMs);
}

/** Per-character gradient text, e.g. the compact wordmark or the Thinking… shimmer. */
export interface GradientRange {
  readonly start: number;
  readonly end: number;
  readonly bold?: boolean;
}

export function gradientText(theme: Theme, text: string, range: GradientRange): string {
  const characters = [...text];
  const span = Math.max(characters.length - 1, 1);
  return characters.map((character, index) => {
    if (character === ' ') return character;
    const t = range.start + ((range.end - range.start) * index) / span;
    return theme.paint(character, { foreground: theme.gradientSpec(t), bold: range.bold ?? false });
  }).join('');
}
