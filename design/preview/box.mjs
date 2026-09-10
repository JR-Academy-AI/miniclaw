// Bordered box shared by the welcome card (gradient border) and panels/dialogs (solid border).
import { paint, displayWidth, padDisplayEnd, borderSet } from './ansi.mjs';

// borderColorAt({ column, row, width, height }) → color spec or token name.
export function renderBox(context, { width, rows, borderColorAt, weight = 'rounded', title = '' }) {
  const border = borderSet(context, weight);
  const height = rows.length + 2;
  const at = (character, column, row) =>
    paint(context, character, { foreground: borderColorAt({ column, row, width, height }), bold: weight === 'heavy' });
  const horizontalRun = (row, fromColumn, toColumn) =>
    Array.from({ length: Math.max(toColumn - fromColumn, 0) }, (_, index) => at(border.horizontal, fromColumn + index, row)).join('');

  const titleSegment = title ? `${at(border.horizontal, 1, 0)} ${title} ` : '';
  const titleWidth = title ? displayWidth(title) + 3 : 0;
  const top = at(border.topLeft, 0, 0) + titleSegment + horizontalRun(0, 1 + titleWidth, width - 1) + at(border.topRight, width - 1, 0);
  const bottomRow = height - 1;
  const bottom = at(border.bottomLeft, 0, bottomRow) + horizontalRun(bottomRow, 1, width - 1) + at(border.bottomRight, width - 1, bottomRow);
  const body = rows.map((content, index) =>
    `${at(border.vertical, 0, index + 1)} ${padDisplayEnd(content, width - 4)} ${at(border.vertical, width - 1, index + 1)}`);
  return [top, ...body, bottom];
}
