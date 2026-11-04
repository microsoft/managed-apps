/**
 * The Shiki-backed {@link SyntaxEngine}.
 *
 * This is the only file in the app that knows Shiki exists. Everything upstream
 * talks in {@link TokenKind} and {@link TokenRange}, so replacing this module —
 * with a hand-rolled tokenizer, or a different library — is a local change.
 *
 * Three decisions are worth knowing about:
 *
 * **The JavaScript regex engine, not Oniguruma.** Shiki's default engine is a
 * WebAssembly build of Oniguruma, several hundred kilobytes that would have to
 * download before the first line of code could be coloured. `createJavaScriptRegexEngine`
 * compiles the same TextMate patterns to native `RegExp` instead, which removes
 * the WASM payload entirely. It is `forgiving`, so a pattern it cannot translate
 * is dropped rather than thrown — a rule that stops matching degrades one token
 * to plain text instead of failing the file.
 *
 * **Grammars load one at a time, on demand.** Every entry in {@link GRAMMARS} is
 * its own dynamic `import()`, so the bundler emits one chunk per language and a
 * reviewer only ever downloads the grammars for files they actually open. The
 * fixed cost of turning highlighting on is the core plus the regex engine.
 *
 * **One highlighter for the life of the app.** Creating it is expensive and it
 * is immutable apart from the grammar cache, so it is a module-level singleton
 * behind a promise. The host forbids workers (`worker-src 'none'`), so we tokenize
 * incrementally and yield to the browser between small batches instead.
 */

import type { GrammarState, HighlighterCore, LanguageRegistration } from 'shiki/core';
import {
  SYNTAX_THEME,
  SYNTAX_THEME_NAME,
  SYNTAX_TIMEOUT_MS,
  MAX_SYNTAX_LINE_LENGTH,
  kindForColor,
  type SyntaxEngine,
  type TokenRange,
} from './tokens';
import { LANGUAGE_IDS, type LanguageId } from './languages';

type GrammarModule = { default: LanguageRegistration[] };

const BATCH_LINES = 20;
const BATCH_MS = 8;

/**
 * Language id → the module that defines its grammar.
 *
 * Written out longhand rather than built from a template string because
 * bundlers need a statically analysable specifier to split the chunk. Each
 * module already carries the grammars it embeds — `vue` pulls in HTML, CSS and
 * TypeScript on its own — so nothing here has to model dependencies.
 */
const GRAMMARS: Record<LanguageId, () => Promise<GrammarModule>> = {
  c: () => import('@shikijs/langs/c'),
  cpp: () => import('@shikijs/langs/cpp'),
  csharp: () => import('@shikijs/langs/csharp'),
  css: () => import('@shikijs/langs/css'),
  diff: () => import('@shikijs/langs/diff'),
  dockerfile: () => import('@shikijs/langs/dockerfile'),
  go: () => import('@shikijs/langs/go'),
  graphql: () => import('@shikijs/langs/graphql'),
  html: () => import('@shikijs/langs/html'),
  ini: () => import('@shikijs/langs/ini'),
  java: () => import('@shikijs/langs/java'),
  javascript: () => import('@shikijs/langs/javascript'),
  json: () => import('@shikijs/langs/json'),
  jsonc: () => import('@shikijs/langs/jsonc'),
  jsx: () => import('@shikijs/langs/jsx'),
  kotlin: () => import('@shikijs/langs/kotlin'),
  less: () => import('@shikijs/langs/less'),
  make: () => import('@shikijs/langs/make'),
  markdown: () => import('@shikijs/langs/markdown'),
  php: () => import('@shikijs/langs/php'),
  powershell: () => import('@shikijs/langs/powershell'),
  proto: () => import('@shikijs/langs/proto'),
  python: () => import('@shikijs/langs/python'),
  ruby: () => import('@shikijs/langs/ruby'),
  rust: () => import('@shikijs/langs/rust'),
  scss: () => import('@shikijs/langs/scss'),
  shellscript: () => import('@shikijs/langs/shellscript'),
  sql: () => import('@shikijs/langs/sql'),
  swift: () => import('@shikijs/langs/swift'),
  toml: () => import('@shikijs/langs/toml'),
  tsx: () => import('@shikijs/langs/tsx'),
  typescript: () => import('@shikijs/langs/typescript'),
  vue: () => import('@shikijs/langs/vue'),
  xml: () => import('@shikijs/langs/xml'),
  yaml: () => import('@shikijs/langs/yaml'),
};

let highlighterPromise: Promise<HighlighterCore> | null = null;

/**
 * The shared highlighter, created on first use.
 *
 * A failed creation clears the cached promise so a later attempt can retry —
 * otherwise one transient chunk-load failure would disable highlighting for the
 * rest of the session.
 */
function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = (async () => {
      const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
        import('shiki/core'),
        import('shiki/engine/javascript'),
      ]);
      return createHighlighterCore({
        themes: [SYNTAX_THEME],
        langs: [],
        engine: createJavaScriptRegexEngine({ forgiving: true }),
      });
    })().catch((err: unknown) => {
      highlighterPromise = null;
      throw err;
    });
  }
  return highlighterPromise;
}

/**
 * Start downloading the highlighter without waiting for it.
 *
 * Called as soon as the setting is known to be on, so the core is usually in
 * memory by the time a file is opened and the plain→coloured swap is invisible.
 * The client logs warmup failures; the next real request can retry.
 */
export async function warmUpSyntaxEngine(): Promise<void> {
  await getHighlighter();
}

const loaded = new Map<LanguageId, Promise<void>>();

function ensureLanguage(highlighter: HighlighterCore, lang: LanguageId): Promise<void> {
  let pending = loaded.get(lang);
  if (!pending) {
    pending = GRAMMARS[lang]()
      .then((mod) => highlighter.loadLanguage(mod.default))
      .catch((err: unknown) => {
        loaded.delete(lang);
        throw err;
      });
    loaded.set(lang, pending);
  }
  return pending;
}

/**
 * Turn one line's themed tokens into kind ranges, merging neighbours.
 *
 * A grammar routinely splits a single visual run — an identifier and the
 * whitespace after it, a string and its escape — into several tokens that map
 * to the same kind. Merging them collapses a row of `<span>`s into one, which
 * matters because this runs on every line of every file.
 */
function toRanges(
  tokens: ReadonlyArray<{ content: string; offset: number; color?: string }>,
): TokenRange[] {
  const ranges: TokenRange[] = [];
  for (const token of tokens) {
    const kind = kindForColor(token.color);
    if (!kind) continue;
    const start = token.offset;
    const end = start + token.content.length;
    if (end <= start) continue;
    const last = ranges[ranges.length - 1];
    if (last && last.kind === kind && last.end === start) last.end = end;
    else ranges.push({ start, end, kind });
  }
  return ranges;
}

/**
 * Each call covers one line, carrying grammar state across lines and yields.
 * Both budgets are cooperative: an individual native RegExp cannot be preempted.
 */
export const shikiEngine: SyntaxEngine = {
  async tokenize(text: string, lang: string, signal?: AbortSignal): Promise<TokenRange[][]> {
    signal?.throwIfAborted();
    if (!isSupported(lang)) return [];
    const deadline = Date.now() + SYNTAX_TIMEOUT_MS;
    function remainingTime(): number {
      signal?.throwIfAborted();
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('Syntax highlighting timed out');
      return remaining;
    }
    const highlighter = await getHighlighter();
    remainingTime();
    await ensureLanguage(highlighter, lang);
    remainingTime();
    const lines = text.split('\n');
    const result: TokenRange[][] = [];
    let grammarState: GrammarState | undefined;
    let index = 0;
    while (index < lines.length) {
      // A task boundary (not a resolved promise) lets paint, input and abort run.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      remainingTime();
      const start = performance.now();
      const end = Math.min(index + BATCH_LINES, lines.length);
      do {
        const tokens = highlighter.codeToTokensBase(lines[index], {
          lang,
          theme: SYNTAX_THEME_NAME,
          includeExplanation: false,
          grammarState,
          // Shiki skips at >= this limit; the viewer permits the boundary itself.
          tokenizeMaxLineLength: MAX_SYNTAX_LINE_LENGTH + 1,
          // Shiki silently truncates tokens at its default 500 ms limit.
          tokenizeTimeLimit: remainingTime(),
        });
        // Reject partial tokens and grammar state if the line exhausted its budget.
        remainingTime();
        grammarState = highlighter.getLastGrammarState(tokens);
        result.push(toRanges(tokens[0] ?? []));
        index += 1;
      } while (index < end && performance.now() - start < BATCH_MS);
    }
    return result;
  },
};

const SUPPORTED = new Set<string>(LANGUAGE_IDS);

/** True when a grammar is registered for `lang`. */
export function isSupported(lang: string): lang is LanguageId {
  return SUPPORTED.has(lang);
}
