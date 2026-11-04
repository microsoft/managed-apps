import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { ParsedDiff, DiffLineType } from '../../../types';
import type { TokenRange } from '../../../utils/syntax/tokens';

const tokenize = vi.fn<(text: string, lang: string, signal?: AbortSignal) => Promise<TokenRange[][]>>();
const warmUp = vi.fn();

vi.mock('../../../utils/syntax/engine', () => ({
  shikiEngine: { tokenize: (text: string, lang: string, signal?: AbortSignal) => tokenize(text, lang, signal) },
  warmUpSyntaxEngine: () => warmUp(),
}));

const { useSyntaxHighlight } = await import('../useSyntaxHighlight');
const { cellKeyOf } = await import('../diffSearchModel');

type Line = { type: Exclude<DiffLineType, 'hunk' | 'meta'>; content: string };

function makeDiff(lines: Line[]): ParsedDiff {
  return {
    isEmpty: false,
    hunks: [
      {
        header: '@@ -1,1 +1,1 @@',
        oldStart: 1,
        oldLines: lines.length,
        newStart: 1,
        newLines: lines.length,
        lines: [
          { type: 'hunk', content: '@@ -1,1 +1,1 @@' },
          ...lines.map((l, i) => ({
            type: l.type,
            content: l.content,
            ...(l.type === 'del' ? { oldLineNo: i + 1 } : {}),
            ...(l.type === 'add' ? { newLineNo: i + 1 } : {}),
            ...(l.type === 'context' ? { oldLineNo: i + 1, newLineNo: i + 1 } : {}),
          })),
        ],
      },
    ],
  };
}

/** One `keyword` token covering each line, so tokens are easy to assert on. */
function tokensPerLine(text: string): TokenRange[][] {
  return text.split('\n').map((line) => (line ? [{ start: 0, end: line.length, kind: 'keyword' as const }] : []));
}

beforeEach(() => {
  vi.clearAllMocks();
  tokenize.mockImplementation((text) => Promise.resolve(tokensPerLine(text)));
});

afterEach(() => vi.restoreAllMocks());

const render = (diff: ParsedDiff, path: string | undefined, enabled = true) =>
  renderHook(() => useSyntaxHighlight(diff, 'inline', 'both', path, enabled));

describe('useSyntaxHighlight', () => {
  it('stays inactive when the setting is off', () => {
    const { result } = render(makeDiff([{ type: 'add', content: 'x' }]), 'a.ts', false);
    expect(result.current.active).toBe(false);
    expect(tokenize).not.toHaveBeenCalled();
  });

  it('stays inactive for a language it does not recognise', () => {
    const { result } = render(makeDiff([{ type: 'add', content: 'x' }]), 'a.unknownext');
    expect(result.current.active).toBe(false);
    expect(tokenize).not.toHaveBeenCalled();
  });

  it('stays inactive with no file path', () => {
    expect(render(makeDiff([{ type: 'add', content: 'x' }]), undefined).result.current.active).toBe(false);
  });

  it('is active before the tokens arrive, so the colour scheme does not flicker', () => {
    const { result } = render(makeDiff([{ type: 'add', content: 'x' }]), 'a.ts');
    expect(result.current.active).toBe(true);
    expect(result.current.tokensFor('inline', '0-1')).toEqual([]);
  });

  it('fills tokens in once they resolve', async () => {
    const { result } = render(makeDiff([{ type: 'add', content: 'const' }]), 'a.ts');
    await waitFor(() => expect(result.current.tokensFor('inline', '0-1')).toHaveLength(1));
    expect(result.current.tokensFor('inline', '0-1')[0]).toEqual({ start: 0, end: 5, kind: 'keyword' });
  });

  it('tokenizes both sides with the resolved language', async () => {
    render(makeDiff([{ type: 'del', content: 'old' }, { type: 'add', content: 'new' }]), 'src/Program.cs');
    await waitFor(() => expect(tokenize).toHaveBeenCalledTimes(2));
    expect(tokenize.mock.calls.map((c) => c[0])).toEqual(['old', 'new']);
    expect(tokenize.mock.calls.every((c) => c[1] === 'csharp')).toBe(true);
  });

  it('returns nothing for a cell it has no location for', async () => {
    const { result } = render(makeDiff([{ type: 'add', content: 'x' }]), 'a.ts');
    await waitFor(() => expect(tokenize).toHaveBeenCalled());
    expect(result.current.tokensFor('inline', '99-99')).toEqual([]);
    expect(result.current.tokensFor('left', '0-1')).toEqual([]);
  });

  it('blanks over-long lines but keeps the line count', async () => {
    const long = 'x'.repeat(2001);
    render(makeDiff([{ type: 'add', content: long }, { type: 'add', content: 'ok' }]), 'a.ts');
    await waitFor(() => expect(tokenize).toHaveBeenCalledTimes(2));
    const sent = tokenize.mock.calls.find((c) => c[0].includes('ok'))![0];
    // The long line is gone, but its slot survives so every index still lines up.
    expect(sent).toBe('\nok');
  });

  it.each([
    [4000, 'add'],
    [4001, 'add'],
    [2000, 'context'],
    [2001, 'context'],
    [10000, 'context'],
  ] as const)('highlights through the last of %i %s lines', async (length, type) => {
    const many: Line[] = Array.from({ length }, () => ({ type, content: 'x' }));
    const { result } = render(makeDiff(many), 'a.ts');
    expect(result.current.active).toBe(true);
    expect(result.current.deferRendering).toBe(length * (type === 'context' ? 2 : 1) > 4000);
    await waitFor(() => expect(result.current.tokensFor('inline', `0-${length}`))
      .toEqual([{ start: 0, end: 1, kind: 'keyword' }]));
    expect(tokenize).toHaveBeenCalledTimes(2);
  });

  it.each(['both', 'left', 'right'] as const)('highlights large split diffs with %s sides visible', async (sideMode) => {
    const diff = makeDiff(Array.from({ length: 5000 }, () => ({ type: 'context', content: 'const x = 1;' })));
    const { result } = renderHook(() => useSyntaxHighlight(diff, 'split', sideMode, 'a.ts', true));
    await waitFor(() => expect(result.current.tokensFor(sideMode === 'left' ? 'left' : 'right', '5000')).toHaveLength(1));
    expect(result.current.deferRendering).toBe(true);
    if (sideMode !== 'both') {
      expect(result.current.tokensFor(sideMode === 'left' ? 'right' : 'left', '5000')).toEqual([]);
    }
  });

  it('renders plain when the grammar fails to load', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    tokenize.mockRejectedValue(new Error('no grammar'));
    const { result } = render(makeDiff([{ type: 'add', content: 'x' }]), 'a.ts');
    await waitFor(() => expect(warning).toHaveBeenCalled());
    expect(tokenize.mock.calls[0][2]?.aborted).toBe(true);
    // Still "active" — the row tints stay weakened — but nothing is coloured.
    expect(result.current.tokensFor('inline', '0-1')).toEqual([]);
  });

  it('warms the engine up as soon as the setting is on', () => {
    render(makeDiff([{ type: 'add', content: 'x' }]), undefined);
    expect(warmUp).toHaveBeenCalled();
  });

  it('does not warm the engine up when the setting is off', () => {
    render(makeDiff([{ type: 'add', content: 'x' }]), 'a.ts', false);
    expect(warmUp).not.toHaveBeenCalled();
  });

  it('ignores a result that arrives after the file changed', async () => {
    let settleFirst: (v: TokenRange[][]) => void = () => {};
    tokenize.mockImplementationOnce(() => new Promise((res) => { settleFirst = res; }));
    tokenize.mockImplementation((text) => Promise.resolve(tokensPerLine(text)));

    const diff = makeDiff([{ type: 'add', content: 'x' }]);
    const { result, rerender } = renderHook(
      ({ path }: { path: string }) => useSyntaxHighlight(diff, 'inline', 'both', path, true),
      { initialProps: { path: 'a.ts' } },
    );
    const firstSignal = tokenize.mock.calls[0][2]!;
    rerender({ path: 'b.cs' });
    expect(firstSignal.aborted).toBe(true);
    // The stale promise resolves last and must not overwrite the new file's tokens.
    settleFirst([[{ start: 0, end: 99, kind: 'string' }]]);

    await waitFor(() => expect(result.current.tokensFor('inline', '0-1')).toHaveLength(1));
    expect(result.current.tokensFor('inline', '0-1')[0].kind).toBe('keyword');
  });

  it('cancels both tokenization jobs when disabled or unmounted', () => {
    tokenize.mockImplementation(() => new Promise(() => {}));
    const diff = makeDiff([{ type: 'add', content: 'x' }]);
    const { rerender, unmount } = renderHook(
      ({ enabled }) => useSyntaxHighlight(diff, 'split', 'both', 'a.ts', enabled),
      { initialProps: { enabled: true } },
    );
    const signal = tokenize.mock.calls[0][2]!;
    expect(tokenize.mock.calls[1][2]).toBe(signal);
    expect(signal.aborted).toBe(false);
    rerender({ enabled: false });
    expect(signal.aborted).toBe(true);
    rerender({ enabled: true });
    const latest = tokenize.mock.calls.at(-1)![2]!;
    expect(latest.aborted).toBe(false);
    unmount();
    expect(latest.aborted).toBe(true);
  });
});

describe('cellKeyOf', () => {
  it('is the key the hook looks cells up by', () => {
    expect(cellKeyOf('inline', '0-1')).toBe('inline:0-1');
  });
});
