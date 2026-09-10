import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { AsyncQueue } from './queue.js';
import { codexEnvironment, serverArgs, type CodexCliOptions } from './options.js';

export type RpcMessage = Record<string, unknown>;
export interface RpcClient {
  request(method: string, params: RpcMessage): Promise<RpcMessage>;
  notify(method: string, params?: RpcMessage): void;
  respond(id: unknown, result: RpcMessage): void;
  reject(id: unknown): void;
  next(): Promise<RpcMessage>;
  close(): void;
}
interface Pending {
  resolve(value: RpcMessage): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export class StdioRpc implements RpcClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly incoming = new AsyncQueue<RpcMessage>();
  private readonly pending = new Map<number, Pending>();
  private sequence = 0;
  private buffer = '';
  private closed = false;

  constructor(options: CodexCliOptions, cwd: string) {
    this.child = spawn(options.executablePath ?? 'codex', serverArgs(), {
      cwd, env: codexEnvironment(process.env), stdio: 'pipe',
    });
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => this.read(chunk));
    this.child.stderr.resume(); // Never surface credential-bearing provider diagnostics.
    this.child.on('error', (error) => this.fail(error));
    this.child.on('exit', (code) => this.fail(new Error(`Codex app-server exited (${code ?? 'signal'}).`)));
    this.child.stdin.on('error', (error) => this.fail(error));
  }

  request(method: string, params: RpcMessage): Promise<RpcMessage> {
    if (this.closed) return Promise.reject(new Error('Codex session closed.'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.fail(new Error(`Codex ${method} timed out.`)); }, 60_000);
      this.pending.set(id, { resolve, reject, timer });
      this.write({ id, method, params });
    });
  }

  notify(method: string, params: RpcMessage = {}): void { this.write({ method, params }); }
  respond(id: unknown, result: RpcMessage): void { this.write({ id, result }); }
  reject(id: unknown): void { this.write({ id, error: { code: -32601, message: 'Unavailable in miniclaw text-only mode.' } }); }
  next(): Promise<RpcMessage> { return this.incoming.next(); }

  private write(message: RpcMessage): void {
    if (!this.closed) this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private read(chunk: string): void {
    this.buffer += chunk;
    if (this.buffer.length > 4 * 1024 * 1024) { this.fail(new Error('Codex sent an oversized protocol message.')); return; }
    for (;;) {
      const end = this.buffer.indexOf('\n');
      if (end < 0) return;
      const line = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 1);
      try { this.route(JSON.parse(line) as RpcMessage); }
      catch { this.fail(new Error('Codex sent invalid JSON-RPC.')); return; }
    }
  }

  private route(message: RpcMessage): void {
    const pending = typeof message.id === 'number' ? this.pending.get(message.id) : undefined;
    if (!pending || typeof message.method === 'string') { this.incoming.push(message); return; }
    this.pending.delete(message.id as number);
    clearTimeout(pending.timer);
    if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
    else pending.resolve((message.result ?? {}) as RpcMessage);
  }

  private fail(error: Error): void {
    this.incoming.end(error);
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
    this.close();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.incoming.end();
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('Codex session closed.')); }
    this.pending.clear();
    this.child.stdin.end();
    this.child.kill('SIGTERM');
    const timer = setTimeout(() => { if (this.child.exitCode === null) this.child.kill('SIGKILL'); }, 2_000);
    timer.unref();
  }
}
