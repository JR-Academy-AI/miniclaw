import type { Key } from 'ink';
import type { ApprovalChoice } from '../core/approval.js';

export interface Editor { readonly text: string; readonly cursor: number }
export const emptyEditor: Editor = { text: '', cursor: 0 };

export function isReturnInput(input: string, key: Pick<Key, 'return'>): boolean {
  return key.return || input === '\r' || input === '\n' || input === '\r\n';
}

export function approvalKey(input: string, key: Pick<Key, 'return' | 'escape'>): ApprovalChoice | null {
  if (isReturnInput(input, key) || key.escape || input.toLowerCase() === 'd') return 'deny';
  if (input.toLowerCase() === 'a') return 'once';
  if (input.toLowerCase() === 's') return 'session';
  return null;
}

export function editInput(editor: Editor, input: string, key: Key): Editor {
  const { text, cursor } = editor;
  if (key.leftArrow) return { text, cursor: Math.max(0, cursor - 1) };
  if (key.rightArrow) return { text, cursor: Math.min(text.length, cursor + 1) };
  if (key.home || (key.ctrl && input === 'a')) return { text, cursor: 0 };
  if (key.end || (key.ctrl && input === 'e')) return { text, cursor: text.length };
  if (key.ctrl && input === 'u') return emptyEditor;
  if ((key.ctrl && input === 'd') || input === '\x1b[3~') return { text: text.slice(0, cursor) + text.slice(cursor + 1), cursor };
  // Ink maps terminal DEL (the usual macOS Backspace) to key.delete and drops its raw byte.
  if (key.backspace || key.delete || input === '\x08' || input === '\x7f' || (key.ctrl && input === 'h')) {
    return { text: text.slice(0, Math.max(0, cursor - 1)) + text.slice(cursor), cursor: Math.max(0, cursor - 1) };
  }
  if (key.ctrl || key.escape || key.upArrow || key.downArrow || key.tab) return editor;
  const inserted = key.return ? '\n' : cleanInput(input);
  return { text: text.slice(0, cursor) + inserted + text.slice(cursor), cursor: cursor + inserted.length };
}

function cleanInput(input: string): string {
  return input
    .replace(/\x1b\[200~/g, '')
    .replace(/\x1b\[201~/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
}

export function hasNewlineIntent(editor: Editor, key: Pick<Key, 'return' | 'meta' | 'shift'>): boolean {
  return key.return && (key.meta || key.shift || editor.text.endsWith('\\'));
}
