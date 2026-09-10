// Defensive readers for engine messages. The SDK's message payload types come from
// @anthropic-ai/sdk, which is not installed, so they resolve loosely; we read fields as unknown.

export type RawRecord = Readonly<Record<string, unknown>>;

export function asRecord(value: unknown): RawRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as RawRecord) : null;
}

export function readString(record: RawRecord | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === 'string' ? value : null;
}

export function readNumber(record: RawRecord | null, key: string): number | null {
  const value = record?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function readRecord(record: RawRecord | null, key: string): RawRecord | null {
  return asRecord(record?.[key]);
}

export function readArray(record: RawRecord | null, key: string): readonly unknown[] {
  const value = record?.[key];
  return Array.isArray(value) ? value : [];
}

/** Collapses whitespace and cuts to `max` characters, marking the cut with "...". */
export function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 3)}...`;
}
