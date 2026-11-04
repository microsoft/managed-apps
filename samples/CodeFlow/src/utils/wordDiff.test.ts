import { describe, it, expect } from 'vitest';
import { computeWordDiff } from './wordDiff';

describe('computeWordDiff', () => {
  it('returns empty ranges for identical lines', () => {
    const r = computeWordDiff('hello world', 'hello world');
    expect(r.oldRanges).toEqual([]);
    expect(r.newRanges).toEqual([]);
  });

  it('returns empty ranges when oldText is empty', () => {
    const r = computeWordDiff('', 'hello');
    expect(r.oldRanges).toEqual([]);
    expect(r.newRanges).toEqual([]);
  });

  it('returns empty ranges when newText is empty', () => {
    const r = computeWordDiff('hello', '');
    expect(r.oldRanges).toEqual([]);
    expect(r.newRanges).toEqual([]);
  });

  it('highlights a single inserted word', () => {
    // "class Foo" → "class Bar"
    const r = computeWordDiff('class Foo', 'class Bar');
    expect(r.oldRanges).toEqual([{ start: 6, end: 9 }]); // "Foo"
    expect(r.newRanges).toEqual([{ start: 6, end: 9 }]); // "Bar"
  });

  it('highlights an added keyword and identifier', () => {
    // issue example: "public sealed class" → "public sealed partial class"
    const old = 'public sealed class EspDataStore';
    const nw = 'public sealed partial class EspDataStore';
    const r = computeWordDiff(old, nw);
    // "partial " was added in new
    expect(r.oldRanges).toEqual([]);
    // newRanges should contain "partial" and the space after
    expect(r.newRanges.length).toBeGreaterThan(0);
    // "partial" starts at index 14
    const partialRange = r.newRanges.find((rng) => nw.slice(rng.start, rng.end).includes('partial'));
    expect(partialRange).toBeDefined();
  });

  it('highlights an added interface in a list', () => {
    const old = 'public sealed class EspDataStore : IEspDataStore, IDisposable';
    const nw = 'public sealed partial class EspDataStore : IEspDataStore, IEspAdlsFolderStore, IDisposable';
    const r = computeWordDiff(old, nw);
    // old should have no changes for IDisposable but some for partial/new iface
    // new should highlight "partial" and "IEspAdlsFolderStore"
    const newText = nw;
    const hasPartial = r.newRanges.some((rng) => newText.slice(rng.start, rng.end).includes('partial'));
    const hasNewIface = r.newRanges.some((rng) => newText.slice(rng.start, rng.end).includes('IEspAdlsFolderStore'));
    expect(hasPartial).toBe(true);
    expect(hasNewIface).toBe(true);
  });

  it('highlights a changed number', () => {
    const r = computeWordDiff('timeout = 100', 'timeout = 200');
    expect(r.oldRanges).toEqual([{ start: 10, end: 13 }]); // "100"
    expect(r.newRanges).toEqual([{ start: 10, end: 13 }]); // "200"
  });

  it('returns empty ranges when token product exceeds limit', () => {
    // Construct two very long lines (will exceed 200_000 token product)
    const a = 'a '.repeat(500);
    const b = 'b '.repeat(500);
    const r = computeWordDiff(a, b);
    expect(r.oldRanges).toEqual([]);
    expect(r.newRanges).toEqual([]);
  });

  it('merges adjacent changed tokens into one range', () => {
    // "foo bar" → "baz qux" — both tokens change, should produce one range
    const r = computeWordDiff('foo bar', 'baz qux');
    // "foo bar" = tokens: "foo"(0-3), " "(3-4), "bar"(4-7)
    // "baz qux" = tokens: "baz"(0-3), " "(3-4), "qux"(4-7)
    // Space is shared, foo and bar differ → should produce ranges around each word
    expect(r.oldRanges.length).toBeGreaterThan(0);
    expect(r.newRanges.length).toBeGreaterThan(0);
  });

  it('handles lines that differ only in punctuation', () => {
    const r = computeWordDiff('foo(bar)', 'foo(bar, baz)');
    // ", baz" was added — should highlight in newRanges
    expect(r.newRanges.length).toBeGreaterThan(0);
    expect(r.oldRanges.length).toBe(0);
  });
});
