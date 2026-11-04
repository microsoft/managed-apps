/**
 * The token vocabulary the diff viewer paints with, and the TextMate theme that
 * produces it.
 *
 * This file is the seam between "some tokenizer" and "the diff renderer". The
 * renderer only ever sees a {@link TokenKind}; it has no idea a TextMate grammar
 * was involved. Swapping the engine out later (for a hand-rolled tokenizer, say)
 * means reimplementing {@link SyntaxEngine} and leaving everything downstream
 * alone.
 *
 * The kinds are deliberately few. A diff is read in a narrow column, often over
 * a coloured add/del background, so a thirty-colour editor theme would be noise:
 * the useful signal is "this is a comment / a string / a name", not which of
 * four flavours of punctuation it is. Anything unmatched renders plain, which is
 * both the safe default and the cheap one — no wrapper element at all.
 *
 * ## How a kind comes back out of a TextMate grammar
 *
 * TextMate themes speak in colours, not names, so the theme below paints each
 * kind with a unique **sentinel** colour and {@link kindForColor} maps it back.
 * The sentinels are private to this module and never reach the DOM: the renderer
 * turns a kind into a `tok--<kind>` class and lets CSS pick the real palette,
 * which is what lets the three app themes restyle code without re-tokenizing it.
 *
 * Sentinels are plain hex rather than `var(--tok-…)` custom properties on
 * purpose. Shiki does support arbitrary colour values, but it implements them by
 * substituting placeholders during tokenization, and the mechanism is documented
 * as diverging from TextMate compatibility. Hex needs none of that machinery and
 * behaves the same on every version.
 */

/**
 * A syntactic category the diff viewer knows how to colour.
 *
 * Text that matches nothing is *not* given a kind — see {@link kindForColor} —
 * so `TokenKind` has no `plain` member by design.
 */
export type TokenKind =
  | 'variable'
  | 'property'
  | 'constant'
  | 'number'
  | 'string'
  | 'regexp'
  | 'comment'
  | 'keyword'
  | 'operator'
  | 'type'
  | 'function'
  | 'tag'
  | 'attr';

/** A half-open `[start, end)` character range within one line, and its kind. */
export interface TokenRange {
  start: number;
  end: number;
  kind: TokenKind;
}

/** Longer individual lines stay plain to bound regex work on minified files. */
export const MAX_SYNTAX_LINE_LENGTH = 2000;

/** Cooperative deadline, including cold grammar downloads. */
export const SYNTAX_TIMEOUT_MS = 10_000;

/**
 * Tokenizes source text into per-line ranges.
 *
 * Implementations must return one entry per line of `text` (split on `\n`), with
 * ranges sorted, non-overlapping, and expressed as columns within their own
 * line. Returning fewer lines than the input is read as "the rest of the file is
 * plain" rather than as an error.
 */
export interface SyntaxEngine {
  tokenize(text: string, lang: string, signal?: AbortSignal): Promise<TokenRange[][]>;
}

/**
 * TextMate scopes per kind, broad selector first.
 *
 * Resolution is by specificity — the longest matching selector wins — so a rule
 * listed under one kind can be overridden by a longer selector under another.
 * That is used deliberately: `variable` claims the whole `variable` tree, and
 * `property` and `constant` then reclaim the specific branches they care about.
 */
const SCOPES: ReadonlyArray<readonly [TokenKind, readonly string[]]> = [
  ['variable', ['variable', 'variable.other', 'variable.parameter', 'meta.definition.variable']],
  [
    'property',
    [
      'variable.other.property',
      'variable.other.object.property',
      'support.variable.property',
      'meta.object-literal.key',
      'support.type.property-name',
      'entity.name.tag.yaml',
    ],
  ],
  [
    'constant',
    [
      'constant.language',
      'constant.other',
      'support.constant',
      'variable.other.constant',
      'entity.name.constant',
    ],
  ],
  ['number', ['constant.numeric']],
  [
    'string',
    [
      'string',
      'string.quoted',
      'string.template',
      'punctuation.definition.string',
      'constant.character',
      'constant.character.escape',
      'constant.other.symbol',
    ],
  ],
  ['regexp', ['string.regexp', 'constant.regexp']],
  ['comment', ['comment', 'punctuation.definition.comment']],
  ['keyword', ['keyword', 'keyword.control', 'keyword.other', 'storage', 'storage.modifier']],
  ['operator', ['keyword.operator', 'punctuation.accessor']],
  [
    'type',
    [
      'entity.name.type',
      'entity.name.class',
      'entity.name.namespace',
      'entity.other.inherited-class',
      'support.type',
      'support.class',
    ],
  ],
  [
    'function',
    ['entity.name.function', 'variable.function', 'support.function', 'meta.function-call.generic'],
  ],
  ['tag', ['entity.name.tag', 'punctuation.definition.tag']],
  ['attr', ['entity.other.attribute-name']],
];

/** Every kind, in the order the theme declares them. Useful for tests and CSS audits. */
export const TOKEN_KINDS: readonly TokenKind[] = SCOPES.map(([kind]) => kind);

/**
 * The colour a token carries when it matched no rule. Mapped back to "no kind",
 * so ordinary code costs nothing extra to render.
 */
const PLAIN_COLOR = '#000000';

/** `#000001`, `#000002`, … — one private sentinel per kind, in declaration order. */
function sentinelFor(index: number): string {
  return `#${(index + 1).toString(16).padStart(6, '0')}`;
}

const COLOR_TO_KIND = new Map<string, TokenKind>(
  SCOPES.map(([kind], i) => [sentinelFor(i), kind] as const),
);

/**
 * Recover the {@link TokenKind} a tokenizer colour stands for.
 *
 * Returns `null` for the plain foreground and for anything unrecognised, which
 * the renderer treats as "emit bare text". Colours are compared lower-cased
 * because grammars and themes are inconsistent about hex casing.
 */
export function kindForColor(color: string | undefined): TokenKind | null {
  if (!color) return null;
  return COLOR_TO_KIND.get(color.toLowerCase()) ?? null;
}

/** The CSS class the renderer puts on a token of this kind. */
export function tokenClass(kind: TokenKind): string {
  return `tok tok--${kind}`;
}

/**
 * The TextMate theme handed to the tokenizer.
 *
 * Every rule paints a sentinel rather than a real colour, so this theme is never
 * something a human sees — it exists purely to carry scope classification back
 * across the engine boundary.
 */
export const SYNTAX_THEME = {
  name: 'codeflow-kinds',
  type: 'dark' as const,
  fg: PLAIN_COLOR,
  bg: PLAIN_COLOR,
  settings: SCOPES.map(([, scopes], i) => ({
    scope: [...scopes],
    settings: { foreground: sentinelFor(i) },
  })),
};

/** Name the theme is registered under; the engine passes this to `codeToTokens`. */
export const SYNTAX_THEME_NAME = SYNTAX_THEME.name;
