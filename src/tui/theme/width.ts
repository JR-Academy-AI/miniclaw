// Display-width math (DESIGN §9): CJK and fullwidth characters take 2 columns, combining
// marks take 0, SGR sequences take 0. Every alignment in the TUI goes through these.

const SGR_PATTERN = /\x1b\[[0-9;]*m/g;
const WIDE_RANGES: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f], [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff],
  [0xa000, 0xa4cf], [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe30, 0xfe4f], [0xff00, 0xff60],
  [0xffe0, 0xffe6], [0x1f300, 0x1faff], [0x20000, 0x3fffd],
];
const ZERO_WIDTH_RANGES: readonly (readonly [number, number])[] = [
  [0x0300, 0x036f], [0x200b, 0x200f], [0xfe00, 0xfe0f],
];

const inRanges = (codePoint: number, ranges: readonly (readonly [number, number])[]): boolean =>
  ranges.some(([low, high]) => codePoint >= low && codePoint <= high);

export function characterWidth(character: string): number {
  const codePoint = character.codePointAt(0) ?? 0;
  if (codePoint < 0x20 || inRanges(codePoint, ZERO_WIDTH_RANGES)) return 0;
  return inRanges(codePoint, WIDE_RANGES) ? 2 : 1;
}

export function stripSgr(text: string): string {
  return text.replace(SGR_PATTERN, '');
}

export function displayWidth(text: string): number {
  let width = 0;
  for (const character of stripSgr(text)) width += characterWidth(character);
  return width;
}

export function padDisplayEnd(text: string, width: number): string {
  return text + ' '.repeat(Math.max(width - displayWidth(text), 0));
}

/** Cuts plain text to at most `width` columns, ending with `ellipsis` when something was cut. */
export function truncateEnd(text: string, width: number, ellipsis = '…'): string {
  if (displayWidth(text) <= width) return text;
  const budget = Math.max(width - displayWidth(ellipsis), 0);
  let used = 0;
  let result = '';
  for (const character of text) {
    const next = characterWidth(character);
    if (used + next > budget) break;
    result += character;
    used += next;
  }
  return result + ellipsis;
}

/** Keeps the last `width` columns of plain text, starting with `ellipsis` when something was cut. */
export function truncateStart(text: string, width: number, ellipsis = '…'): string {
  if (displayWidth(text) <= width) return text;
  const budget = Math.max(width - displayWidth(ellipsis), 0);
  const characters = [...text];
  let used = 0;
  let start = characters.length;
  while (start > 0 && used + characterWidth(characters[start - 1]!) <= budget) {
    start -= 1;
    used += characterWidth(characters[start]!);
  }
  return ellipsis + characters.slice(start).join('');
}

function breakLongWord(word: string, width: number): string[] {
  const pieces: string[] = [];
  let current = '';
  for (const character of word) {
    if (displayWidth(current + character) > width && current) {
      pieces.push(current);
      current = '';
    }
    current += character;
  }
  return current ? [...pieces, current] : pieces;
}

/** Word-wraps one paragraph of plain text to `width` columns; words longer than a line are broken. */
export function wrapText(text: string, width: number): string[] {
  const safeWidth = Math.max(width, 1);
  const lines: string[] = [];
  let current = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = current ? `${current} ${word}` : word;
    if (displayWidth(candidate) <= safeWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    const pieces = breakLongWord(word, safeWidth);
    current = pieces.pop() ?? '';
    lines.push(...pieces);
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}
