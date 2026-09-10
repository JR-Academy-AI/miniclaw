import { closeSync, fsyncSync, openSync, writeSync } from 'node:fs';
import type { EventSink } from '../core/events.js';

export interface Transcript extends EventSink { close(): void }

export function createTranscript(filePath: string): Transcript {
  const descriptor = openSync(filePath, 'ax', 0o600);
  let closed = false;
  return {
    write(event) {
      if (closed) throw new Error('Cannot write a closed transcript.');
      const line = Buffer.from(JSON.stringify({ timestamp: new Date().toISOString(), ...event }) + '\n');
      let offset = 0;
      while (offset < line.length) offset += writeSync(descriptor, line, offset);
      fsyncSync(descriptor);
    },
    close() {
      if (closed) return;
      closeSync(descriptor);
      closed = true;
    },
  };
}
