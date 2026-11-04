import { describe, it, expect } from 'vitest';
import {
  DRAFT_PREFIX,
  DRAFT_TTL_MS,
  clearDraft,
  editDraftKey,
  findLineDraftAnchor,
  hasDraft,
  lineDraftKey,
  prDraftKey,
  pruneDrafts,
  readDraft,
  replyDraftKey,
  reviewDraftKey,
  writeDraft,
} from '../commentDrafts';
import { z } from 'zod';
import { appStorage } from '../../storage';

const NOW = Date.UTC(2026, 0, 10);

describe('draft keys', () => {
  it('scopes every draft to its pull request', () => {
    // Two reviews open side by side must never see each other's text.
    expect(prDraftKey('o/r#1')).not.toBe(prDraftKey('o/r#2'));
    expect(replyDraftKey('o/r#1', 't1')).not.toBe(replyDraftKey('o/r#1', 't2'));
    expect(editDraftKey('o/r#1', 'c1')).not.toBe(replyDraftKey('o/r#1', 'c1'));
    expect(reviewDraftKey('o/r#1', 'COMMENT')).not.toBe(reviewDraftKey('o/r#1', 'REQUEST_CHANGES'));
    expect(prDraftKey('o/r#1')).toContain(DRAFT_PREFIX);
  });

  it('turns persistence off rather than guessing at a key', () => {
    // Before the PR is known there is nothing safe to key on, so drafts are
    // simply not stored — sharing one fallback key would leak text between PRs.
    expect(prDraftKey(undefined)).toBeNull();
    expect(replyDraftKey(undefined, 't1')).toBeNull();
    expect(reviewDraftKey('o/r#1', null)).toBeNull();
    expect(lineDraftKey('o/r#1', undefined, 'right', 12)).toBeNull();
  });
});

describe('draft storage', () => {
    it('reads back what was written', () => {
    const key = prDraftKey('o/r#1');
    writeDraft(key, 'half a thought');
    expect(readDraft(key)).toBe('half a thought');
    expect(hasDraft(key)).toBe(true);
  });

  it('treats an emptied box as no draft at all', () => {
    // Otherwise deliberately clearing the composer would come back as a
    // restored draft the next time it opened.
    const key = prDraftKey('o/r#1');
    writeDraft(key, 'typed then removed');
    writeDraft(key, '   ');
    expect(readDraft(key)).toBe('');
    expect(hasDraft(key)).toBe(false);
    expect(appStorage().drafts.get(key!, z.unknown())).toBeUndefined();
  });

  it('does nothing at all with a null key', () => {
    writeDraft(null, 'nowhere to put this');
    expect(readDraft(null)).toBe('');
    expect(hasDraft(null)).toBe(false);
    expect(appStorage().drafts.keys()).toHaveLength(0);
    expect(() => clearDraft(null)).not.toThrow();
  });

  it('forgets a draft on demand', () => {
    const key = replyDraftKey('o/r#1', 't1');
    writeDraft(key, 'sent already');
    clearDraft(key);
    expect(readDraft(key)).toBe('');
  });

  it('drops a draft once it has gone stale', () => {
    const key = prDraftKey('o/r#1');
    writeDraft(key, 'from a fortnight ago', NOW);
    expect(readDraft(key, NOW + DRAFT_TTL_MS - 1)).toBe('from a fortnight ago');
    expect(readDraft(key, NOW + DRAFT_TTL_MS + 1)).toBe('');
    // And the read cleans up after itself rather than leaving it to rot.
    expect(appStorage().drafts.get(key!, z.unknown())).toBeUndefined();
  });

  it('survives storage holding something it did not write', () => {
    const key = prDraftKey('o/r#1');
    appStorage().drafts.set(key!, 'not json');
    expect(readDraft(key)).toBe('');
  });

  it('sweeps expired drafts and leaves live ones alone', () => {
    writeDraft(prDraftKey('o/r#1'), 'old', NOW);
    writeDraft(prDraftKey('o/r#2'), 'new', NOW + DRAFT_TTL_MS);
    appStorage().drafts.set('codeflow:summary:o/r#1', 'unrelated');

    pruneDrafts(NOW + DRAFT_TTL_MS + 1);

    expect(readDraft(prDraftKey('o/r#1'), NOW + DRAFT_TTL_MS + 1)).toBe('');
    expect(readDraft(prDraftKey('o/r#2'), NOW + DRAFT_TTL_MS + 1)).toBe('new');
    // Nothing outside the draft namespace is ours to delete.
    expect(appStorage().drafts.get('codeflow:summary:o/r#1', z.unknown())).toBe('unrelated');
  });
});

describe('findLineDraftAnchor', () => {
    it('finds the line a draft was being written against', () => {
    writeDraft(lineDraftKey('o/r#1', 'src/app.ts', 'right', 12), 'this looks wrong');
    expect(findLineDraftAnchor('o/r#1', 'src/app.ts')).toEqual({ side: 'right', line: 12 });
  });

  it('recovers the anchor even when the filename contains a separator', () => {
    // The key packs several fields together; the filename goes last precisely
    // so a name like this cannot be mistaken for one of them.
    const odd = 'src/a|b/weird|name.ts';
    writeDraft(lineDraftKey('o/r#1', odd, 'left', 7), 'still mine');
    expect(findLineDraftAnchor('o/r#1', odd)).toEqual({ side: 'left', line: 7 });
  });

  it('ignores drafts belonging to another file or another pull request', () => {
    writeDraft(lineDraftKey('o/r#1', 'src/other.ts', 'right', 3), 'elsewhere');
    writeDraft(lineDraftKey('o/r#2', 'src/app.ts', 'right', 3), 'another PR');
    expect(findLineDraftAnchor('o/r#1', 'src/app.ts')).toBeNull();
  });

  it('ignores a draft that has aged out', () => {
    writeDraft(lineDraftKey('o/r#1', 'src/app.ts', 'right', 12), 'ancient', NOW);
    expect(findLineDraftAnchor('o/r#1', 'src/app.ts', NOW + DRAFT_TTL_MS + 1)).toBeNull();
  });

  it('has nothing to find without a pull request or a file', () => {
    writeDraft(lineDraftKey('o/r#1', 'src/app.ts', 'right', 12), 'text');
    expect(findLineDraftAnchor(undefined, 'src/app.ts')).toBeNull();
    expect(findLineDraftAnchor('o/r#1', undefined)).toBeNull();
  });
});
