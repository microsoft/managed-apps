import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { shikiEngine } from '../shikiEngine';
import { SyntaxClient } from '../engine';
import { SYNTAX_TIMEOUT_MS } from '../tokens';
import { renderCell } from '../../../components/DiffViewer/renderCell';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('real syntax highlighting', () => {
  it('renders colored token classes with the deployed host restriction on workers', async () => {
    const worker = vi.fn(() => { throw new Error("worker-src 'none'"); });
    vi.stubGlobal('Worker', worker);
    const text = 'const answer = "hello";';
    const [tokens] = await new SyntaxClient().tokenize(text, 'typescript');
    const { container } = render(<div>{renderCell(text, [], tokens)}</div>);
    expect(container.textContent).toBe(text);
    expect(container.querySelector('.tok--keyword')?.textContent).toBe('const');
    expect(container.querySelector('.tok--string')?.textContent).toBe('"hello"');
    expect(worker).not.toHaveBeenCalled();
  });

  it.each([2, 7])('keeps complete tokens after a 600 ms pause at clock read %i', async (pauseAfter) => {
    await shikiEngine.tokenize('const warm = 1;', 'typescript');
    let reads = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => (++reads <= pauseAfter ? 0 : 600));
    const text = 'const answer = "hello";';
    const [tokens] = await new SyntaxClient().tokenize(text, 'typescript');
    const { container } = render(<div>{renderCell(text, [], tokens)}</div>);
    expect(container.textContent).toBe(text);
    expect(container.querySelector('.tok--keyword')?.textContent).toBe('const');
    expect(container.querySelector('.tok--string')?.textContent).toBe('"hello"');
  });

  it.each([1, 5, 7])(
    'rejects expired tokens and leaves the next document clean after clock read %i',
    async (pauseAfter) => {
      await shikiEngine.tokenize('const warm = 1;', 'typescript');
      let reads = 0;
      const clock = vi.spyOn(Date, 'now')
        .mockImplementation(() => (++reads <= pauseAfter ? 0 : SYNTAX_TIMEOUT_MS + 1));
      await expect(shikiEngine.tokenize('/* unclosed\nstill a comment', 'typescript'))
        .rejects.toThrow('Syntax highlighting timed out');
      clock.mockRestore();
      const [tokens] = await shikiEngine.tokenize('const x = 42;', 'typescript');
      expect(tokens).toContainEqual({ start: 0, end: 5, kind: 'keyword' });
      expect(tokens).toContainEqual({ start: 10, end: 12, kind: 'number' });
    },
  );

  it.each([
    ['typescript', 'const answer = 42;', 'keyword', 'const'],
    ['csharp', 'public class Example {}', 'keyword', 'public'],
    ['json', '{"answer": 42}', 'number', '42'],
  ])('classifies real %s code', async (lang, text, kind, value) => {
    const [tokens] = await shikiEngine.tokenize(text, lang);
    expect(tokens.filter((t) => t.kind === kind).map((t) => text.slice(t.start, t.end)).join(' '))
      .toContain(value);
  });

  it('preserves multiline grammar state and line-local offsets across yields', async () => {
    const schedule = vi.spyOn(globalThis, 'setTimeout');
    const lines = ['/* opening', ...Array.from({ length: 45 }, () => 'inside the comment'), '*/', 'const x = 42;'];
    const tokens = await shikiEngine.tokenize(lines.join('\n'), 'typescript');
    expect(tokens).toHaveLength(lines.length);
    for (let i = 0; i < lines.length - 1; i++) {
      expect(tokens[i]).toEqual([{ start: 0, end: lines[i].length, kind: 'comment' }]);
    }
    expect(tokens.at(-1)).toContainEqual({ start: 0, end: 5, kind: 'keyword' });
    expect(tokens.at(-1)).toContainEqual({ start: 10, end: 12, kind: 'number' });
    expect(schedule.mock.calls.length).toBeGreaterThanOrEqual(Math.ceil(lines.length / 20));
  });

  it('yields after the time budget even before reaching the line-count cap', async () => {
    await shikiEngine.tokenize('const warm = 1;', 'typescript');
    const schedule = vi.spyOn(globalThis, 'setTimeout');
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (clock += 9));
    const tokens = await shikiEngine.tokenize('const x = 1;\nconst y = 2;\nconst z = 3;', 'typescript');
    expect(tokens).toHaveLength(3);
    expect(schedule).toHaveBeenCalledTimes(3);
  });

  it('keeps independent grammar state for old and new documents', async () => {
    const client = new SyntaxClient();
    const [old, next] = await Promise.all([
      client.tokenize('/* unclosed\nstill a comment', 'typescript'),
      client.tokenize('const x = 42;\n', 'typescript'),
    ]);
    expect(old[1]).toEqual([{ start: 0, end: 15, kind: 'comment' }]);
    expect(next[0]).toContainEqual({ start: 0, end: 5, kind: 'keyword' });
    expect(next[1]).toEqual([]);
  });

  it('yields to input and honors cancellation between small batches', async () => {
    await shikiEngine.tokenize('const warm = 1;', 'typescript');
    const controller = new AbortController();
    let yields = 0;
    const setTimer = globalThis.setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((callback, delay, ...args) => {
      yields += 1;
      if (yields === 2) controller.abort();
      return setTimer(callback, delay, ...args);
    });
    await expect(shikiEngine.tokenize(
      Array.from({ length: 100 }, () => 'const x = 42;').join('\n'),
      'typescript',
      controller.signal,
    )).rejects.toMatchObject({ name: 'AbortError' });
    expect(yields).toBe(2);
  });

  it('skips overlong lines and rejects requests already cancelled', async () => {
    expect(await shikiEngine.tokenize(`//${'x'.repeat(1998)}`, 'typescript'))
      .toEqual([[{ start: 0, end: 2000, kind: 'comment' }]]);
    expect(await shikiEngine.tokenize('x'.repeat(2001), 'typescript')).toEqual([[]]);
    const controller = new AbortController();
    controller.abort();
    await expect(shikiEngine.tokenize('const x = 1;', 'typescript', controller.signal))
      .rejects.toMatchObject({ name: 'AbortError' });
  });
});
