import { describe, it, expect } from 'vitest';
import { parsePatch } from './diffParser';
import {
  buildMarkdownPreview,
  isMarkdownPath,
  markdownBlockStatusLabel,
  previewRangeLabel,
} from './markdownPreview';

/** Build a one-hunk patch from raw diff lines (markers included). */
function patch(lines: string[], header = '@@ -1,20 +1,20 @@') {
  return [header, ...lines].join('\n');
}

function blocks(lines: string[], header?: string) {
  return buildMarkdownPreview(parsePatch(patch(lines, header)));
}

describe('isMarkdownPath', () => {
  it.each(['README.md', 'docs/GUIDE.MD', 'notes.markdown', 'page.mdx'])('accepts %s', (p) => {
    expect(isMarkdownPath(p)).toBe(true);
  });

  it.each(['src/app.ts', 'App.css', 'mdfile.txt', '', null, undefined])('rejects %s', (p) => {
    expect(isMarkdownPath(p)).toBe(false);
  });
});

describe('buildMarkdownPreview', () => {
  it('returns nothing for an empty diff', () => {
    expect(buildMarkdownPreview({ hunks: [], isEmpty: true })).toEqual([]);
  });

  it('splits paragraphs on blank lines', () => {
    const out = blocks([' First para.', ' still first.', '', ' Second para.']);
    expect(out.map((b) => b.newText)).toEqual(['First para.\nstill first.', 'Second para.']);
    expect(out.every((b) => b.status === 'unchanged')).toBe(true);
  });

  it('keeps a fenced code block whole, blank lines and bullets included', () => {
    const out = blocks([
      ' ```js',
      ' const a = 1;',
      '',
      ' - not a list item',
      ' # not a heading',
      ' ```',
      ' after',
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].newText).toBe('```js\nconst a = 1;\n\n- not a list item\n# not a heading\n```');
    expect(out[1].newText).toBe('after');
  });

  it('only closes a fence with the same character, at least as long', () => {
    const out = blocks([' ~~~~', ' ~~~', ' text', ' ~~~~', ' after']);
    expect(out[0].newText).toBe('~~~~\n~~~\ntext\n~~~~');
    expect(out[1].newText).toBe('after');
  });

  it('gives an ATX heading its own block', () => {
    const out = blocks([' intro', ' ## Heading', ' body']);
    expect(out.map((b) => b.newText)).toEqual(['intro', '## Heading', 'body']);
  });

  it('keeps a Setext underline attached to the title above it', () => {
    const out = blocks([' Title', ' ---', ' body']);
    expect(out.map((b) => b.newText)).toEqual(['Title\n---', 'body']);
  });

  it('treats a rule with nothing above it as its own block', () => {
    const out = blocks([' before', '', ' ***', ' after']);
    expect(out.map((b) => b.newText)).toEqual(['before', '***', 'after']);
  });

  it('splits top-level list items but keeps nested items with their parent', () => {
    const out = blocks([' - one', '   - nested', ' - two', ' 3. ordered']);
    expect(out.map((b) => b.newText)).toEqual(['- one\n  - nested', '- two', '3. ordered']);
  });

  it('does not split an indented continuation line', () => {
    const out = blocks([' - item', '     more text', ' next']);
    expect(out.map((b) => b.newText)).toEqual(['- item\n    more text\nnext']);
  });

  it('does not split on a marker indented four spaces (indented code)', () => {
    const out = blocks([' text', '     # not a heading']);
    expect(out).toHaveLength(1);
  });

  it('marks a block that gained and lost lines as changed and keeps both sides', () => {
    const out = blocks([' # Title', '', '-Old sentence.', '+New sentence.', '', ' Tail.']);
    expect(out.map((b) => b.status)).toEqual(['unchanged', 'changed', 'unchanged']);
    expect(out[1].oldText).toBe('Old sentence.');
    expect(out[1].newText).toBe('New sentence.');
    expect(out[1].added).toBe(1);
    expect(out[1].removed).toBe(1);
  });

  it('drops the missing side of a pure addition or removal', () => {
    const out = blocks(['+Brand new.', '', '-All gone.']);
    expect(out[0].status).toBe('added');
    expect(out[0].oldText).toBe('');
    expect(out[0].newText).toBe('Brand new.');
    expect(out[1].status).toBe('removed');
    expect(out[1].newText).toBe('');
    expect(out[1].oldText).toBe('All gone.');
  });

  it('records the line range each block came from', () => {
    const out = blocks([' one', ' two', '', ' four'], '@@ -1,4 +1,4 @@');
    expect(out[0]).toMatchObject({ oldStart: 1, oldEnd: 2, newStart: 1, newEnd: 2 });
    expect(out[1]).toMatchObject({ oldStart: 4, oldEnd: 4, newStart: 4, newEnd: 4 });
  });

  it('ignores a blank line that was added or removed', () => {
    // A blank line has no rendered output, so treating one as a change would
    // mark a paragraph edited for something the reviewer cannot see.
    const out = blocks([' Para one.', '+', ' Para two.']);
    expect(out.map((b) => b.status)).toEqual(['unchanged', 'unchanged']);
    expect(out.every((b) => b.added === 0 && b.removed === 0)).toBe(true);
  });

  it('emits a gap block per hunk header and resets fence state across it', () => {
    const out = buildMarkdownPreview(
      parsePatch(
        [
          '@@ -1,2 +1,2 @@',
          ' ```js',
          ' const a = 1;',
          '@@ -40,2 +40,2 @@ Section',
          ' after the gap',
        ].join('\n'),
      ),
    );
    expect(out.map((b) => b.status)).toEqual(['unchanged', 'gap', 'unchanged']);
    expect(out[1].label).toBe('Section');
    expect(out[2].newText).toBe('after the gap');
  });

  it('opens with a gap when the first hunk skipped the top of the file', () => {
    const out = buildMarkdownPreview(parsePatch('@@ -40,1 +40,1 @@\n body'));
    expect(out.map((b) => b.status)).toEqual(['gap', 'unchanged']);
  });

  it('skips "no newline" meta lines', () => {
    const out = blocks([' body', '\\ No newline at end of file']);
    expect(out).toHaveLength(1);
    expect(out[0].newText).toBe('body');
  });

  it('gives every block a distinct key', () => {
    const out = blocks([' a', '', ' b', '', ' c']);
    expect(new Set(out.map((b) => b.key)).size).toBe(out.length);
  });
});

describe('previewRangeLabel', () => {
  it('collapses a single line, ranges a span, and blanks a missing side', () => {
    expect(previewRangeLabel(12, 12)).toBe('12');
    expect(previewRangeLabel(12)).toBe('12');
    expect(previewRangeLabel(12, 18)).toBe('12\u201318');
    expect(previewRangeLabel(undefined, 18)).toBe('');
  });
});

describe('markdownBlockStatusLabel', () => {
  it('names every status', () => {
    expect(markdownBlockStatusLabel('changed')).toBe('Changed');
    expect(markdownBlockStatusLabel('gap')).toBe('Skipped');
  });
});
