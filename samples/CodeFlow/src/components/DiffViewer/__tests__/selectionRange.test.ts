import { describe, it, expect, afterEach } from 'vitest';
import { restoreSelection, saveSelection } from '../selectionRange';

const LINE = 'const value = compute(value);';

/** A diff root holding one code cell, attached so selections are real. */
function cell(text = LINE) {
  const root = document.createElement('div');
  const td = document.createElement('div');
  td.className = 'diff__code';
  td.textContent = text;
  root.appendChild(td);
  document.body.appendChild(root);
  return { root, td };
}

/** Select `[start, end)` of the cell's single text node. */
function select(td: HTMLElement, start: number, end: number) {
  const range = document.createRange();
  range.setStart(td.firstChild as Text, start);
  range.setEnd(td.firstChild as Text, end);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/** Redraw the cell the way the occurrence highlight does: same text, new nodes. */
function markUp(td: HTMLElement) {
  const mark = (text: string) => {
    const el = document.createElement('mark');
    el.textContent = text;
    return el;
  };
  td.textContent = '';
  td.append('const ', mark('value'), ' = compute(', mark('value'), ');');
}

afterEach(() => {
  document.body.innerHTML = '';
  window.getSelection()?.removeAllRanges();
});

describe('saveSelection', () => {
  it('records the selection as offsets into the cell', () => {
    const { root, td } = cell();
    select(td, 6, 11);
    expect(saveSelection(root)).toMatchObject({ container: td, start: 6, end: 11 });
  });

  it('ignores a collapsed caret', () => {
    const { root, td } = cell();
    select(td, 6, 6);
    expect(saveSelection(root)).toBeNull();
  });

  it('ignores a selection made outside the diff', () => {
    const { td } = cell();
    select(td, 6, 11);
    expect(saveSelection(document.createElement('div'))).toBeNull();
  });

  it('ignores a selection that is not inside a code cell', () => {
    const { root } = cell();
    const prose = document.createElement('p');
    prose.textContent = 'not code';
    root.appendChild(prose);
    const range = document.createRange();
    range.setStart(prose.firstChild as Text, 0);
    range.setEnd(prose.firstChild as Text, 3);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    expect(saveSelection(root)).toBeNull();
  });
});

describe('restoreSelection', () => {
  it('survives the rewrite that drawing the marks performs', () => {
    const { root, td } = cell();
    select(td, 6, 11);
    const saved = saveSelection(root);

    markUp(td);
    expect(restoreSelection(saved!)).toBe(true);
    expect(window.getSelection()?.toString()).toBe('value');
  });

  it('lands on the right occurrence, not merely the right text', () => {
    const { root, td } = cell();
    // The *second* `value`, at 22..27 — the one inside `compute(...)`.
    select(td, 22, 27);
    const saved = saveSelection(root);

    markUp(td);
    restoreSelection(saved!);
    const range = window.getSelection()?.getRangeAt(0);
    // The second `<mark>`, not the first — a boundary offset may resolve to the
    // end of the preceding node, so the *end* is what pins the occurrence down.
    expect(range?.endContainer.parentElement).toBe(td.querySelectorAll('mark')[1]);
    expect(window.getSelection()?.toString()).toBe('value');
  });

  it('restores a selection that spanned a mark boundary', () => {
    const { root, td } = cell();
    select(td, 0, 11); // `const value`
    const saved = saveSelection(root);

    markUp(td);
    expect(restoreSelection(saved!)).toBe(true);
    expect(window.getSelection()?.toString()).toBe('const value');
  });

  it('does nothing once the cell has left the document', () => {
    const { root, td } = cell();
    select(td, 6, 11);
    const saved = saveSelection(root);

    root.remove();
    expect(restoreSelection(saved!)).toBe(false);
  });

  it('clamps an offset past the end of a shortened cell', () => {
    const { root, td } = cell();
    select(td, 6, 11);
    const saved = saveSelection(root);

    td.textContent = 'x';
    expect(restoreSelection(saved!)).toBe(true);
    expect(window.getSelection()?.toString()).toBe('');
  });
});
