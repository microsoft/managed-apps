import { SYNTAX_TIMEOUT_MS, type SyntaxEngine, type TokenRange } from './tokens';
import { createLogger } from '../../lib/logger';

const log = createLogger('syntax');

export { SYNTAX_TIMEOUT_MS } from './tokens';

interface Job {
  text: string;
  lang: string;
  resolve(tokens: TokenRange[][]): void;
  reject(error: unknown): void;
  signal?: AbortSignal;
  controller: AbortController;
  abort(): void;
  timer?: ReturnType<typeof setTimeout>;
}

let enginePromise: Promise<typeof import('./shikiEngine')> | null = null;

function getEngine() {
  enginePromise ??= import('./shikiEngine').catch((error: unknown) => {
    enginePromise = null;
    throw error;
  });
  return enginePromise;
}

/** Serializes cooperative tokenization so folder views share one CPU budget. */
export class SyntaxClient implements SyntaxEngine {
  private active: Job | null = null;
  private queue: Job[] = [];

  warmUp(): void {
    void getEngine()
      .then(({ warmUpSyntaxEngine }) => warmUpSyntaxEngine())
      .catch((error: unknown) => log.warn('Engine warmup failed', error));
  }

  tokenize(text: string, lang: string, signal?: AbortSignal): Promise<TokenRange[][]> {
    return new Promise((resolve, reject) => {
      const job: Job = {
        text, lang, signal, resolve, reject, controller: new AbortController(),
        abort: () => {
          job.controller.abort();
          this.queue = this.queue.filter((queued) => queued !== job);
          this.release(job);
          reject(new DOMException('Syntax highlighting cancelled', 'AbortError'));
          // Let all listeners of a shared signal retire before starting another job.
          queueMicrotask(() => this.pump());
        },
      };
      if (signal?.aborted) {
        reject(new DOMException('Syntax highlighting cancelled', 'AbortError'));
        return;
      }
      signal?.addEventListener('abort', job.abort, { once: true });
      this.queue.push(job);
      this.pump();
    });
  }

  private pump(): void {
    if (this.active) return;
    const job = this.queue.shift();
    if (!job) return;
    this.active = job;
    const deadline = performance.now() + SYNTAX_TIMEOUT_MS;
    job.timer = setTimeout(() => this.fail(job, new Error('Syntax highlighting timed out')), SYNTAX_TIMEOUT_MS);
    void getEngine()
      .then(({ shikiEngine }) => {
        job.controller.signal.throwIfAborted();
        return shikiEngine.tokenize(job.text, job.lang, job.controller.signal);
      })
      .then((tokens) => {
        if (this.active !== job) return;
        // A synchronous tokenizer can finish before the overdue timer gets a turn.
        if (performance.now() >= deadline) {
          this.fail(job, new Error('Syntax highlighting timed out'));
          return;
        }
        this.release(job);
        job.resolve(tokens);
        this.pump();
      })
      .catch((error: unknown) => this.fail(job, error));
  }

  private release(job: Job): void {
    clearTimeout(job.timer);
    job.signal?.removeEventListener('abort', job.abort);
    if (this.active === job) this.active = null;
  }

  private fail(job: Job, error: unknown): void {
    if (this.active !== job) return;
    job.controller.abort();
    this.release(job);
    job.reject(error);
    queueMicrotask(() => this.pump());
  }
}

export const shikiEngine = new SyntaxClient();

export function warmUpSyntaxEngine(): void {
  shikiEngine.warmUp();
}
