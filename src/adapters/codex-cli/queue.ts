export class AsyncQueue<T> {
  private readonly values: T[] = [];
  private wake: (() => void) | undefined;
  private ended = false;
  private failure: Error | undefined;

  push(value: T): void {
    if (this.ended) return;
    this.values.push(value);
    this.wake?.();
  }

  end(error?: Error): void {
    if (this.ended) return;
    this.ended = true;
    this.failure = error;
    this.wake?.();
  }

  async next(): Promise<T> {
    while (this.values.length === 0) {
      if (this.ended) throw this.failure ?? new Error('Codex session closed.');
      await new Promise<void>((resolve) => { this.wake = resolve; });
      this.wake = undefined;
    }
    return this.values.shift()!;
  }
}
