// Welcome screen: pixel crab + gradient MINICLAW wordmark + boot-check card.
// composeWelcomeFrame() is a pure function of elapsed time, so static and
// animated rendering share one code path (static = the frame at Infinity).
import { userInfo } from 'node:os';
import { tokens, paint, gradientAt, lighten, blend, displayWidth, glyph } from './ansi.mjs';
import { renderBox } from './box.mjs';
import { SAMPLE_STATUS } from './sample-data.mjs';

const LOGO_LETTERS = {
  M: ['███╗   ███╗', '████╗ ████║', '██╔████╔██║', '██║╚██╔╝██║', '██║ ╚═╝ ██║', '╚═╝     ╚═╝'],
  I: ['██╗', '██║', '██║', '██║', '██║', '╚═╝'],
  N: ['███╗   ██╗', '████╗  ██║', '██╔██╗ ██║', '██║╚██╗██║', '██║ ╚████║', '╚═╝  ╚═══╝'],
  C: [' ██████╗', '██╔════╝', '██║     ', '██║     ', '╚██████╗', ' ╚═════╝'],
  L: ['██╗     ', '██║     ', '██║     ', '██║     ', '███████╗', '╚══════╝'],
  A: [' █████╗ ', '██╔══██╗', '███████║', '██╔══██║', '██║  ██║', '╚═╝  ╚═╝'],
  W: ['██╗    ██╗', '██║    ██║', '██║ █╗ ██║', '██║███╗██║', '╚███╔███╔╝', ' ╚══╝╚══╝ '],
};
const LOGO_ROWS = [0, 1, 2, 3, 4, 5].map((row) => [...'MINICLAW'].map((letter) => LOGO_LETTERS[letter][row]).join(''));
const LOGO_WIDTH = [...LOGO_ROWS[0]].length;

// 16×12 pixels, rendered as 16×6 cells with half blocks. R shell, D highlight, W/K eyes.
const CRAB_BODY = [
  '...R..W..W..R...', '...R..K..K..R...', '..RRRRRRRRRRRR..', '.RRRRRRRRRRRRRR.',
  '.RRDRRRRRRRRDRR.', '..RRRRRRRRRRRR..', '.R.R.R....R.R.R.', 'R.R.R......R.R.R',
];
const CRAB_CLAWS_OPEN = ['..R.R......R.R..', '.RR.RR....RR.RR.', '.RRRRR....RRRRR.', '..RRR......RRR..'];
const CRAB_CLAWS_CLOSED = ['...RR......RR...', '..RRRR....RRRR..', '.RRRRR....RRRRR.', '..RRR......RRR..'];
const CRAB_PIXEL_TOKENS = { R: 'coral', D: 'tangerine', W: 'eyeWhite', K: 'eyeBlack' };
const CRAB_WIDTH = 16;
const CRAB_GAP = 3;

const easeOutCubic = (progress) => 1 - (1 - Math.min(Math.max(progress, 0), 1)) ** 3;

function renderPixelArt(context, pixelRows) {
  const lines = [];
  for (let row = 0; row < pixelRows.length; row += 2) {
    const cells = [...pixelRows[row]].map((topPixel, column) => {
      const top = CRAB_PIXEL_TOKENS[topPixel];
      const bottom = CRAB_PIXEL_TOKENS[pixelRows[row + 1][column]];
      if (!top && !bottom) return ' ';
      if (!top) return paint(context, '▄', { foreground: bottom });
      if (!bottom) return paint(context, '▀', { foreground: top });
      if (top === bottom || context.depth === 'none') return paint(context, '█', { foreground: top });
      return paint(context, '▀', { foreground: top, background: bottom });
    });
    lines.push(cells.join(''));
  }
  return lines;
}

function logoCellColor(context, { column, row, character, shinePosition }) {
  let spec = gradientAt(context, (column + row * 1.5) / (LOGO_WIDTH + 9));
  // Shadow strokes (╗║═…) sit back in depth; solid blocks carry the full color.
  if (character !== '█') spec = blend(spec, context.theme === 'dark' ? [28, 27, 34] : [255, 255, 255], 0.4);
  if (shinePosition === null) return spec;
  const distance = Math.abs((column - row * 2) / LOGO_WIDTH - shinePosition);
  return distance < 0.08 ? lighten(spec, (1 - distance / 0.08) * 0.75) : spec;
}

function renderLogo(context, { reveal, shinePosition }) {
  return LOGO_ROWS.map((line, row) => [...line].map((character, column) => {
    const visible = (column + row * 2) / (LOGO_WIDTH + 10) <= reveal;
    if (character === ' ' || !visible) return ' ';
    const foreground = logoCellColor(context, { column, row, character, shinePosition });
    return paint(context, character, { foreground, bold: character === '█' });
  }).join(''));
}

function greeting(now = new Date()) {
  const hour = now.getHours();
  const salutation = hour < 5 ? 'Still up' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  return `${salutation}, ${userInfo().username}`;
}

function checkState(elapsed, index) {
  const timing = tokens.motion.welcome;
  const startsAt = timing.checkStartMs + index * timing.checkStaggerMs;
  if (elapsed < startsAt) return 'hidden';
  return elapsed < startsAt + timing.checkResolveMs ? 'pending' : 'done';
}

function renderCheckRow(context, check, { state, elapsed }) {
  if (state === 'hidden') return '';
  const label = paint(context, check.label.padEnd(10), { foreground: 'muted' });
  if (state === 'done') return label + check.render(context);
  const frames = context.ascii ? tokens.spinner.asciiFrames : tokens.spinner.frames;
  const frame = frames[Math.floor(elapsed / tokens.spinner.intervalMs) % frames.length];
  return label + paint(context, `${frame} checking…`, { foreground: 'subtle' });
}

// The welcome card is a brand moment, so its border runs the full diagonal gradient.
function renderCard(context, { width, contentRows }) {
  const borderColorAt = ({ column, row, height }) => gradientAt(context, (column + row * 2) / (width + height * 2));
  return renderBox(context, { width, rows: contentRows, borderColorAt });
}

function cardContent(context, { elapsed, innerWidth }) {
  const title = paint(context, greeting(), { bold: true }) + ' ' + paint(context, glyph(context, 'sparkle'), { foreground: 'sun' });
  const version = paint(context, SAMPLE_STATUS.version, { foreground: 'subtle' });
  const headerGap = ' '.repeat(Math.max(innerWidth - displayWidth(title) - displayWidth(version), 1));
  const checks = SAMPLE_STATUS.checks.map((check, index) =>
    renderCheckRow(context, check, { state: checkState(elapsed, index), elapsed }));
  return [title + headerGap + version, '', ...checks];
}

function renderKeyHints(context) {
  return SAMPLE_STATUS.keyHints.map(([key, label]) =>
    paint(context, ` ${key} `, { background: 'surfaceStrong', bold: true }) + ' ' + paint(context, label, { foreground: 'muted' }),
  ).join('  ');
}

function renderPrompt(context) {
  const caret = paint(context, glyph(context, 'prompt'), { foreground: gradientAt(context, 0), bold: true });
  return `${caret} ${paint(context, SAMPLE_STATUS.placeholder, { foreground: 'subtle', italic: true })}`;
}

function layoutFor(width) {
  const { breakpoints, welcomeCrabMinWidth } = tokens.layout;
  if (width >= welcomeCrabMinWidth) return { name: 'wide', blockWidth: CRAB_WIDTH + CRAB_GAP + LOGO_WIDTH };
  if (width >= breakpoints.regular) return { name: 'regular', blockWidth: LOGO_WIDTH };
  return { name: 'compact', blockWidth: Math.max(width - tokens.layout.gutter * 2, 30) };
}

function renderHero(context, layout, elapsed) {
  const timing = tokens.motion.welcome;
  const shineProgress = (elapsed - timing.logoRevealMs * 0.6) / timing.logoShineMs;
  const shinePosition = shineProgress >= 0 && shineProgress <= 1 ? -0.2 + 1.4 * shineProgress : null;
  const logo = renderLogo(context, { reveal: easeOutCubic(elapsed / timing.logoRevealMs), shinePosition });
  const tagline = paint(context, SAMPLE_STATUS.tagline, { foreground: 'muted' });
  if (layout.name === 'regular') return [...logo, tagline];
  const snipping = timing.crabSnipAtMs.some((at) => elapsed >= at && elapsed < at + timing.crabSnipHoldMs);
  const crab = renderPixelArt(context, [...(snipping ? CRAB_CLAWS_CLOSED : CRAB_CLAWS_OPEN), ...CRAB_BODY]);
  const indent = ' '.repeat(CRAB_WIDTH + CRAB_GAP);
  return [...logo.map((line, row) => crab[row] + ' '.repeat(CRAB_GAP) + line), indent + tagline];
}

function renderCompactHero(context) {
  const mascot = paint(context, '(\\/)(°,,°)(\\/)', { foreground: 'coral', bold: true });
  const wordmark = [...'miniclaw'].map((character, index) =>
    paint(context, character, { foreground: gradientAt(context, index / 7), bold: true })).join('');
  return [`${mascot}  ${wordmark}`, paint(context, SAMPLE_STATUS.tagline, { foreground: 'muted' })];
}

export function composeWelcomeFrame(context, elapsed) {
  const layout = layoutFor(context.width);
  const innerWidth = layout.blockWidth - 4;
  const content = cardContent(context, { elapsed, innerWidth });
  const hero = layout.name === 'compact' ? renderCompactHero(context) : renderHero(context, layout, elapsed);
  const card = layout.name === 'compact' ? content : renderCard(context, { width: layout.blockWidth, contentRows: content });
  const margin = ' '.repeat(tokens.layout.gutter);
  return ['', ...hero, '', ...card, renderKeyHints(context), '', renderPrompt(context)]
    .map((line) => (line ? margin + line : line));
}
