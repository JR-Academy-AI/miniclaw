// One-line summaries of tool calls and results for the chat view and transcript.
import { isAbsolute, relative } from 'node:path';
import { asRecord, oneLine, readArray, readString, type RawRecord } from './read.js';

const MAX_KEY_LENGTH = 60;
const MAX_RESULT_LENGTH = 80;

/** The input field that best says what a call does, per engine tool. */
const KEY_FIELD: Readonly<Record<string, string>> = {
  Bash: 'command',
  Read: 'file_path',
  Write: 'file_path',
  Edit: 'file_path',
  NotebookEdit: 'notebook_path',
  Glob: 'pattern',
  Grep: 'pattern',
  WebFetch: 'url',
  WebSearch: 'query',
  Task: 'description',
  Agent: 'description',
};

const PATH_FIELDS = new Set(['file_path', 'notebook_path']);

function displayPath(path: string, cwd: string | null): string {
  if (cwd === null || !isAbsolute(path)) return path;
  const inside = relative(cwd, path);
  return inside === '' || inside.startsWith('..') ? path : inside;
}

function keyValue(tool: string, input: RawRecord): { field: string; value: string } | null {
  const preferred = KEY_FIELD[tool];
  const preferredValue = preferred === undefined ? null : readString(input, preferred);
  if (preferred !== undefined && preferredValue !== null) return { field: preferred, value: preferredValue };
  for (const [field, value] of Object.entries(input)) {
    if (typeof value === 'string' && value.trim() !== '') return { field, value };
  }
  return null;
}

/** e.g. "Bash(npm test)", "Read(src/app.ts)", or just "TodoWrite". */
export function summarizeToolCall(tool: string, input: unknown, cwd: string | null): string {
  const record = asRecord(input);
  const key = record === null ? null : keyValue(tool, record);
  if (key === null) return tool;
  const value = PATH_FIELDS.has(key.field) ? displayPath(key.value, cwd) : key.value;
  return `${tool}(${oneLine(value, MAX_KEY_LENGTH)})`;
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  const texts = readArray({ content }, 'content')
    .map((block) => readString(asRecord(block), 'text'))
    .filter((text): text is string => text !== null);
  return texts.join('\n');
}

/** First non-empty line of a tool_result's content, or a fallback when it has no text. */
export function summarizeToolResult(content: unknown, ok: boolean): string {
  const firstLine = resultText(content).split('\n').find((line) => line.trim() !== '');
  if (firstLine !== undefined) return oneLine(firstLine, MAX_RESULT_LENGTH);
  return ok ? 'done' : 'failed';
}
