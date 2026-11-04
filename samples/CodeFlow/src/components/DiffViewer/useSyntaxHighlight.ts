/**
 * Syntax highlighting for the diff viewer.
 *
 * Tokenizing is asynchronous — the grammar for a language is fetched the first
 * time a file needs it, then small batches yield to the UI — so this hook renders
 * nothing on the first pass and fills the colour in when the tokens arrive.
 * The diff is already on screen by then; nothing waits.
 *
 * Large documents keep their tokens, but defer offscreen token spans to avoid
 * multiplying the DOM size by the number of tokens in the whole file.
 * Individual lines over {@link MAX_SYNTAX_LINE_LENGTH} stay plain to bound
 * regex work on minified files without disqualifying the rest of the file.
 *
 * Unrecognised languages are not an error state. They render plain, which is
 * what the diff did before this existed.
 */

import { useEffect, useMemo, useState } from 'react';
import type { ParsedDiff } from '../../types';
import type { ViewMode } from '../../state/codeFlowContext';
import type { DiffSideMode } from '../../utils/diffSide';
import { languageForPath } from '../../utils/syntax/languages';
import { shikiEngine, warmUpSyntaxEngine } from '../../utils/syntax/engine';
import { MAX_SYNTAX_LINE_LENGTH, type TokenRange } from '../../utils/syntax/tokens';
import { buildSideDocuments, type SideDocuments } from '../../utils/syntax/sideDocuments';
import type { SearchColumn } from './diffSearchModel';
import { cellKeyOf } from './diffSearchModel';
import { createLogger } from '../../lib/logger';

const log = createLogger('syntax');

/**
 * Above this two-sided line count, render syntax only near the viewport.
 * Tokenization still covers both complete documents, preserving grammar state
 * for lines reached by scrolling, search or comment navigation.
 */
const EAGER_SYNTAX_LINES = 4000;
const NO_TOKENS: TokenRange[] = [];

interface Tokenized {
  /**
   * The documents these tokens came from. Compared by identity at render time so
   * a result that lands after the file changed is ignored rather than shown for
   * a frame against the wrong lines.
   */
  docs: SideDocuments;
  old: TokenRange[][];
  new: TokenRange[][];
}

export interface SyntaxHighlight {
  /**
   * True when this file is being highlighted — the setting is on and we have a
   * grammar for it. Set before the tokens arrive, so the diff's colour scheme
   * doesn't change under the reader a moment after it renders.
   */
  active: boolean;
  /** Avoid mounting offscreen token spans for a large diff. */
  deferRendering: boolean;
  /** The syntax tokens for one rendered cell, in column order. */
  tokensFor(column: SearchColumn, rowKey: string): TokenRange[];
}

const INACTIVE: SyntaxHighlight = { active: false, deferRendering: false, tokensFor: () => NO_TOKENS };

/**
 * Replace over-long lines with blanks before tokenizing.
 *
 * Keeping the line *count* identical is what makes this safe: every downstream
 * index still lines up, and the skipped line simply comes back with no tokens.
 */
function elide(text: string): string {
  if (text.length === 0) return text;
  const lines = text.split('\n');
  let changed = false;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].length > MAX_SYNTAX_LINE_LENGTH) {
      lines[i] = '';
      changed = true;
    }
  }
  return changed ? lines.join('\n') : text;
}

export function useSyntaxHighlight(
  diff: ParsedDiff,
  viewMode: ViewMode,
  sideMode: DiffSideMode,
  filePath: string | undefined,
  enabled: boolean,
): SyntaxHighlight {
  const language = useMemo(
    () => (enabled && filePath ? languageForPath(filePath) : null),
    [enabled, filePath],
  );

  const documents = useMemo<SideDocuments | null>(() => {
    if (!language) return null;
    return buildSideDocuments(diff, viewMode, sideMode);
  }, [language, diff, viewMode, sideMode]);

  const [tokens, setTokens] = useState<Tokenized | null>(null);

  // Start fetching the engine the moment the setting is known to be on, rather
  // than when a file first needs it. It is the same download either way; doing
  // it early usually means the first file is already coloured on first paint.
  useEffect(() => {
    if (enabled) warmUpSyntaxEngine();
  }, [enabled]);

  useEffect(() => {
    if (!language || !documents) return;
    let live = true;
    const controller = new AbortController();
    void Promise.all([
      shikiEngine.tokenize(elide(documents.old), language, controller.signal),
      shikiEngine.tokenize(elide(documents.new), language, controller.signal),
    ])
      .then(([oldLines, newLines]) => {
        if (live) setTokens({ docs: documents, old: oldLines, new: newLines });
      })
      .catch((error: unknown) => {
        if (!live) return;
        log.warn('Highlighting unavailable; showing plain text', error);
        controller.abort();
      });
    return () => {
      live = false;
      controller.abort();
    };
  }, [language, documents]);

  return useMemo<SyntaxHighlight>(() => {
    if (!language || !documents) return INACTIVE;
    const { cells } = documents;
    // Tokens for a file we have since navigated away from are simply not ours.
    const ready = tokens && tokens.docs === documents ? tokens : null;
    return {
      active: true,
      deferRendering: documents.lineCount > EAGER_SYNTAX_LINES,
      tokensFor(column, rowKey) {
        if (!ready) return NO_TOKENS;
        const at = cells.get(cellKeyOf(column, rowKey));
        if (!at) return NO_TOKENS;
        const lines = at.side === 'old' ? ready.old : ready.new;
        return lines[at.line] ?? NO_TOKENS;
      },
    };
  }, [language, documents, tokens]);
}
