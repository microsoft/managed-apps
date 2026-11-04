import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SyntaxClient, SYNTAX_TIMEOUT_MS } from '../engine';
import { shikiEngine, warmUpSyntaxEngine } from '../shikiEngine';
import type { TokenRange } from '../tokens';

vi.mock('../shikiEngine', () => ({
  shikiEngine: { tokenize: vi.fn() },
  warmUpSyntaxEngine: vi.fn(),
}));

interface Request {
  text: string;
  signal: AbortSignal;
  resolve(tokens: TokenRange[][]): void;
  reject(error: Error): void;
}

let requests: Request[];

beforeEach(() => {
  requests = [];
  vi.useFakeTimers();
  vi.stubGlobal('Worker', vi.fn(() => { throw new Error("worker-src 'none'"); }));
  vi.mocked(shikiEngine.tokenize).mockImplementation((text, _lang, signal) =>
    new Promise((resolve, reject) => requests.push({ text, signal: signal!, resolve, reject })));
  vi.mocked(warmUpSyntaxEngine).mockResolvedValue();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

const flush = () => vi.dynamicImportSettled();

describe('syntax queue without workers', () => {
  it('highlights with workers forbidden and processes only one side at a time', async () => {
    const client = new SyntaxClient();
    client.warmUp();
    const old = client.tokenize('old', 'typescript');
    const next = client.tokenize('new', 'typescript');
    await flush();
    expect(requests.map((job) => job.text)).toEqual(['old']);
    const tokens: TokenRange[][] = [[{ start: 0, end: 3, kind: 'keyword' }]];
    requests[0].resolve(tokens);
    expect(await old).toEqual(tokens);
    await flush();
    expect(requests.map((job) => job.text)).toEqual(['old', 'new']);
    requests[1].resolve([]);
    await next;
    expect(Worker).not.toHaveBeenCalled();
    expect(warmUpSyntaxEngine).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels both sides while preserving other files and ignores late failures', async () => {
    const client = new SyntaxClient();
    const controller = new AbortController();
    const old = client.tokenize('old', 'typescript', controller.signal);
    const next = client.tokenize('new', 'typescript', controller.signal);
    const abandoned = Promise.all([
      expect(old).rejects.toMatchObject({ name: 'AbortError' }),
      expect(next).rejects.toMatchObject({ name: 'AbortError' }),
    ]);
    const current = client.tokenize('current', 'csharp');
    await flush();
    controller.abort();
    await abandoned;
    await vi.advanceTimersByTimeAsync(0);
    await flush();
    expect(requests.map((job) => job.text)).toEqual(['old', 'current']);
    expect(requests[0].signal.aborted).toBe(true);
    requests[0].reject(new Error('obsolete failure'));
    await flush();
    expect(requests[1].signal.aborted).toBe(false);
    requests[1].resolve([]);
    expect(await current).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels a queued file without cancelling the running file', async () => {
    const client = new SyntaxClient();
    const first = client.tokenize('first', 'typescript');
    const controller = new AbortController();
    const queued = client.tokenize('abandoned', 'typescript', controller.signal);
    const rejected = expect(queued).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejected;
    await flush();
    expect(requests[0].signal.aborted).toBe(false);
    requests[0].resolve([]);
    await first;
    expect(requests).toHaveLength(1);
  });

  it('does not start an already cancelled request', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(new SyntaxClient().tokenize('x', 'typescript', controller.signal))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(shikiEngine.tokenize).not.toHaveBeenCalled();
  });

  it('times out stalled work and gives the next job its own full budget', async () => {
    const client = new SyntaxClient();
    const stalled = client.tokenize('stalled', 'typescript');
    const rejected = expect(stalled).rejects.toThrow('timed out');
    const next = client.tokenize('next', 'json');
    await flush();
    await vi.advanceTimersByTimeAsync(SYNTAX_TIMEOUT_MS - 1);
    expect(requests[0].signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await rejected;
    await flush();
    expect(requests[0].signal.aborted).toBe(true);
    expect(requests[1].text).toBe('next');
    requests[0].resolve([[{ start: 0, end: 99, kind: 'string' }]]);
    await vi.advanceTimersByTimeAsync(SYNTAX_TIMEOUT_MS - 1);
    expect(requests[1].signal.aborted).toBe(false);
    requests[1].resolve([]);
    expect(await next).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([SYNTAX_TIMEOUT_MS - 1, SYNTAX_TIMEOUT_MS, SYNTAX_TIMEOUT_MS + 1])(
    'checks synchronous results against the job deadline before timers run (%i ms)',
    async (elapsed) => {
      const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
      const client = new SyntaxClient();
      const first = client.tokenize('first', 'typescript');
      const expired = elapsed >= SYNTAX_TIMEOUT_MS;
      const checked = expired
        ? expect(first).rejects.toThrow('Syntax highlighting timed out')
        : expect(first).resolves.toEqual([]);
      const next = client.tokenize('next', 'typescript');
      await flush();
      clock.mockReturnValue(elapsed);
      requests[0].resolve([]);
      await checked;
      expect(requests[0].signal.aborted).toBe(expired);
      await flush();
      expect(requests[1].text).toBe('next');
      expect(requests[1].signal.aborted).toBe(false);
      requests[1].resolve([]);
      await next;
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('rejects grammar failures without fabricating successful tokens and allows retry', async () => {
    const client = new SyntaxClient();
    const first = client.tokenize('first', 'typescript');
    const rejected = expect(first).rejects.toThrow('grammar failed');
    const next = client.tokenize('next', 'json');
    await flush();
    requests[0].reject(new Error('grammar failed'));
    await rejected;
    await vi.advanceTimersByTimeAsync(0);
    await flush();
    requests[1].resolve([]);
    await next;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('logs warmup failure without blocking later requests', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(warmUpSyntaxEngine).mockRejectedValueOnce(new Error('chunk failed'));
    const client = new SyntaxClient();
    client.warmUp();
    await flush();
    expect(warning).toHaveBeenCalledWith('[codeflow:syntax] Engine warmup failed', expect.stringContaining('Error'));
    const result = client.tokenize('retry', 'json');
    await flush();
    requests[0].resolve([]);
    await result;
  });

  it('detaches old abort listeners through 25 completed files', async () => {
    const client = new SyntaxClient();
    for (let i = 0; i < 25; i++) {
      const controller = new AbortController();
      const result = client.tokenize(`file ${i}`, 'typescript', controller.signal);
      await flush();
      requests[i].resolve([]);
      await result;
      controller.abort();
      expect(requests[i].signal.aborted).toBe(false);
    }
    expect(vi.getTimerCount()).toBe(0);
  });
});
