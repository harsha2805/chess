import type { Engine, EvaluateOptions, RawLine } from './types';

/** A line-based connection to a UCI engine (a Web Worker in the browser, a process in Node). */
export interface Transport {
  send(command: string): void;
  onLine: ((line: string) => void) | null;
  onError: ((error: Error) => void) | null;
  close(): void;
}

/** Parses a UCI "info" line into a principal variation, or null if it carries no exact score. */
export function parseInfo(line: string): (RawLine & { multipv: number }) | null {
  if (!line.startsWith('info ') || !line.includes(' pv ')) return null;
  if (line.includes(' lowerbound') || line.includes(' upperbound')) return null;
  const depth = /\bdepth (\d+)/.exec(line);
  const score = /\bscore (cp|mate) (-?\d+)/.exec(line);
  if (!depth || !score) return null;
  const multipv = /\bmultipv (\d+)/.exec(line);
  const pv = line.slice(line.indexOf(' pv ') + 4).trim().split(/\s+/);
  const value = Number(score[2]);
  return {
    multipv: multipv ? Number(multipv[1]) : 1,
    depth: Number(depth[1]),
    move: pv[0],
    pv,
    ...(score[1] === 'cp' ? { cp: value } : { mate: value }),
  };
}

export class UciEngine implements Engine {
  name = 'Stockfish';
  private waiters: { test: (line: string) => boolean; resolve: () => void; reject: (e: Error) => void }[] = [];
  private infoHandler: ((line: string) => void) | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private ready: Promise<void>;
  private multipv = 1;
  private failed: Error | null = null;

  constructor(private transport: Transport) {
    transport.onLine = (line) => this.handle(line);
    transport.onError = (error) => this.fail(error);
    this.ready = this.handshake();
    // Callers observe the failure through their own awaits.
    this.ready.catch(() => undefined);
  }

  private handle(line: string) {
    if (line.startsWith('id name ')) this.name = line.slice(8).trim();
    if (line.startsWith('info ')) this.infoHandler?.(line);
    for (let i = 0; i < this.waiters.length; i++) {
      if (this.waiters[i].test(line)) {
        const [w] = this.waiters.splice(i, 1);
        w.resolve();
        break;
      }
    }
  }

  private fail(error: Error) {
    this.failed = error;
    for (const w of this.waiters.splice(0)) w.reject(error);
  }

  private waitFor(test: (line: string) => boolean): Promise<void> {
    if (this.failed) return Promise.reject(this.failed);
    return new Promise((resolve, reject) => this.waiters.push({ test, resolve, reject }));
  }

  private async handshake() {
    const ok = this.waitFor((l) => l === 'uciok');
    this.transport.send('uci');
    await ok;
    await this.sync();
  }

  private async sync() {
    const ok = this.waitFor((l) => l === 'readyok');
    this.transport.send('isready');
    await ok;
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.queue.then(job, job);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** True once the engine process or worker has died. */
  get broken(): boolean {
    return this.failed !== null;
  }

  whenReady(): Promise<void> {
    return this.ready;
  }

  newGame(): Promise<void> {
    return this.enqueue(async () => {
      await this.ready;
      this.transport.send('ucinewgame');
      await this.sync();
    });
  }

  search(fen: string, opts: EvaluateOptions): Promise<RawLine[]> {
    return this.enqueue(async () => {
      await this.ready;
      if (opts.multipv !== this.multipv) {
        this.transport.send(`setoption name MultiPV value ${opts.multipv}`);
        this.multipv = opts.multipv;
      }
      const lines = new Map<number, RawLine>();
      this.infoHandler = (line) => {
        const info = parseInfo(line);
        if (!info) return;
        const { multipv, ...rest } = info;
        lines.set(multipv, rest);
      };
      const done = this.waitFor((l) => l.startsWith('bestmove'));
      this.transport.send(`position fen ${fen}`);
      this.transport.send(`go depth ${opts.depth}${opts.movetime ? ` movetime ${opts.movetime}` : ''}`);
      try {
        await done;
      } finally {
        this.infoHandler = null;
      }
      return [...lines.entries()].sort((a, b) => a[0] - b[0]).map(([, l]) => l);
    });
  }

  stop() {
    if (!this.failed) this.transport.send('stop');
  }

  dispose() {
    this.fail(new Error('Engine closed'));
    this.transport.close();
  }
}
