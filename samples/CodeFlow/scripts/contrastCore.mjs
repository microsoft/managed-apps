/**
 * Colour maths for the palette accessibility check.
 *
 * `App.css` paints every surface from a design token, and the tokens are the
 * only place a colour is written down. That means the whole palette can be
 * audited by reading the stylesheet: parse the `:root[data-theme=…]` blocks,
 * composite any translucent token over the surface it actually sits on, and
 * measure the WCAG contrast ratio of the pairs the UI really renders.
 *
 * Everything here is pure so `scripts/__tests__/contrast.test.mjs` can hold the
 * palette to a contrast floor on every build.
 */

/** Named CSS colours the stylesheet actually uses. Not a full CSS colour table. */
const NAMED = {
  transparent: { r: 0, g: 0, b: 0, a: 0 },
  white: { r: 255, g: 255, b: 255, a: 1 },
  black: { r: 0, g: 0, b: 0, a: 1 },
};

/**
 * Parse a hex / rgb() / rgba() / named colour into channels plus alpha.
 *
 * Returns `null` for anything that is not a colour (gradients, lengths, font
 * stacks), so callers can filter a token block down to just its colours.
 */
export function parseColor(input) {
  if (typeof input !== 'string') return null;
  const value = input.trim().toLowerCase();

  if (Object.prototype.hasOwnProperty.call(NAMED, value)) return { ...NAMED[value] };

  const hex = /^#([0-9a-f]{3,8})$/.exec(value);
  if (hex) {
    const digits = hex[1];
    // #rgb and #rgba are shorthand for doubled digits.
    const expand = (s) => s.split('').map((c) => c + c).join('');
    const full =
      digits.length === 3 || digits.length === 4 ? expand(digits) : digits;
    if (full.length !== 6 && full.length !== 8) return null;
    const int = (i) => parseInt(full.slice(i, i + 2), 16);
    return {
      r: int(0),
      g: int(2),
      b: int(4),
      a: full.length === 8 ? int(6) / 255 : 1,
    };
  }

  const fn = /^rgba?\(([^)]+)\)$/.exec(value);
  if (fn) {
    const parts = fn[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const chan = (raw) => {
      const n = raw.endsWith('%') ? (parseFloat(raw) / 100) * 255 : parseFloat(raw);
      return Number.isFinite(n) ? Math.min(255, Math.max(0, n)) : null;
    };
    const [r, g, b] = [chan(parts[0]), chan(parts[1]), chan(parts[2])];
    if (r === null || g === null || b === null) return null;
    let a = 1;
    if (parts.length > 3) {
      const raw = parts[3];
      const n = raw.endsWith('%') ? parseFloat(raw) / 100 : parseFloat(raw);
      a = Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1;
    }
    return { r, g, b, a };
  }

  return null;
}

/**
 * Composite a (possibly translucent) colour over an opaque backdrop.
 *
 * Diff rows, find-in-file matches and status pills are all translucent washes
 * layered over a surface, so the colour a reviewer actually sees — and the one
 * that has to pass contrast — only exists after this step.
 */
export function composite(fg, bg) {
  const a = fg.a ?? 1;
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
    a: 1,
  };
}

/** Stack several translucent layers bottom-up onto an opaque base. */
export function flatten(base, ...layers) {
  return layers.reduce((acc, layer) => composite(layer, acc), { ...base, a: 1 });
}

/** WCAG 2.x relative luminance. */
export function relativeLuminance({ r, g, b }) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 2.x contrast ratio between two opaque colours, 1–21. */
export function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Round to 2dp for stable, readable assertion messages. */
export function ratio(a, b) {
  return Math.round(contrastRatio(a, b) * 100) / 100;
}

/**
 * Pull the design tokens out of a stylesheet, keyed by `data-theme` value.
 *
 * The bare `:root` selector is treated as `dark`, matching the stylesheet's own
 * `:root, :root[data-theme='dark']` pairing.
 */
export function parseThemeTokens(css) {
  const themes = new Map();
  // Match each top-level `:root…{ … }` rule. Token blocks contain no nested
  // braces, so a non-greedy run up to the first `}` is exact here.
  const blockRe = /(:root[^{]*)\{([^}]*)\}/g;
  let match;

  while ((match = blockRe.exec(css)) !== null) {
    const [, selector, body] = match;
    if (!body.includes('--')) continue;

    const names = new Set();
    for (const part of selector.split(',')) {
      const themed = /\[data-theme=['"]?([\w-]+)['"]?\]/.exec(part);
      if (themed) names.add(themed[1]);
      else if (part.trim() === ':root') names.add('dark');
    }
    if (names.size === 0) continue;

    const declRe = /(--[\w-]+)\s*:\s*([^;]+);/g;
    let decl;
    const parsed = [];
    while ((decl = declRe.exec(body)) !== null) {
      parsed.push([decl[1], decl[2].trim()]);
    }

    for (const name of names) {
      const existing = themes.get(name) ?? new Map();
      for (const [token, value] of parsed) existing.set(token, value);
      themes.set(name, existing);
    }
  }

  return themes;
}

/**
 * Read a token as a colour, throwing when it is missing or unparseable.
 *
 * A typo in a token name would otherwise silently skip a contrast assertion,
 * which is exactly the failure mode this check exists to prevent.
 */
export function tokenColor(tokens, name) {
  if (!tokens.has(name)) throw new Error(`missing token ${name}`);
  const raw = tokens.get(name);
  const parsed = parseColor(raw);
  if (!parsed) throw new Error(`token ${name} is not a colour: ${raw}`);
  return parsed;
}

/**
 * WCAG 2.1 minimums, as used by the audit below.
 *
 * `TEXT` is 1.4.3 Contrast (Minimum) for body-sized copy. `UI` is 1.4.11
 * Non-text Contrast, which covers control boundaries and other graphics a
 * reviewer has to perceive to operate the app. The stylesheet has no text at
 * WCAG's "large" size (18.66px bold / 24px), so there is no large-text tier —
 * the 10–11px labels are firmly in the `TEXT` bucket.
 */
export const WCAG = { TEXT: 4.5, UI: 3 };

/**
 * Every foreground/background pair the UI actually paints, with the surface
 * each one is composited over.
 *
 * The list is written against `App.css` rule by rule, so a pair here means "the
 * app really renders this combination". Translucent tokens are layered in the
 * same order the browser paints them, including the three-deep case of a
 * find-in-file match sitting on top of a diff row.
 */
export function auditPalette(tokens) {
  const c = (name) => tokenColor(tokens, name);
  const results = [];
  const check = (label, fg, bg, min) =>
    results.push({ label, ratio: ratio(fg, bg), min, pass: ratio(fg, bg) >= min });

  const bg = c('--bg');
  const panel = c('--panel');
  const panel2 = c('--panel-2');
  const surfaces = [
    ['bg', bg],
    ['bg-2', c('--bg-2')],
    ['bg-3', c('--bg-3')],
    ['panel', panel],
    ['panel-2', panel2],
    ['hover', c('--hover')],
    ['input-bg', c('--input-bg')],
  ];

  // Body copy and muted labels have to hold up on every surface they land on.
  for (const [name, surface] of surfaces) {
    check(`--text on --${name}`, c('--text'), surface, WCAG.TEXT);
    check(`--text-dim on --${name}`, c('--text-dim'), surface, WCAG.TEXT);
    check(`--text-bright on --${name}`, c('--text-bright'), surface, WCAG.TEXT);
  }

  // Diff rows: the reviewer's complaint lives here — code on a green or red wash.
  const addRow = flatten(bg, c('--diff-add-bg'));
  const delRow = flatten(bg, c('--diff-del-bg'));
  check('--text on an added line', c('--text'), addRow, WCAG.TEXT);
  check('--text on a removed line', c('--text'), delRow, WCAG.TEXT);
  check('--text-dim on an added line', c('--text-dim'), addRow, WCAG.TEXT);
  check('--text-dim on a removed line', c('--text-dim'), delRow, WCAG.TEXT);
  check('--add marker on an added line', c('--add'), addRow, WCAG.TEXT);
  check('--del marker on a removed line', c('--del'), delRow, WCAG.TEXT);
  check(
    '--diff-add-gutter-fg on the added gutter',
    c('--diff-add-gutter-fg'),
    flatten(panel2, c('--diff-add-gutter-bg')),
    WCAG.TEXT,
  );
  check(
    '--diff-del-gutter-fg on the removed gutter',
    c('--diff-del-gutter-fg'),
    flatten(panel2, c('--diff-del-gutter-bg')),
    WCAG.TEXT,
  );
  check('--diff-lineno on --panel-2', c('--diff-lineno'), panel2, WCAG.TEXT);
  check('--diff-lineno on --diff-empty-bg', c('--diff-lineno'), c('--diff-empty-bg'), WCAG.TEXT);
  check('--text on a suggested addition', c('--text'), flatten(panel, c('--suggest-add-bg')), WCAG.TEXT);
  check('--text on a suggested removal', c('--text'), flatten(panel, c('--suggest-del-bg')), WCAG.TEXT);

  // Find-in-file, including a hit that lands inside a diff row.
  check('--text on a find match', c('--text'), flatten(bg, c('--match-bg')), WCAG.TEXT);
  check(
    '--text on a find match over an added line',
    c('--text'),
    flatten(bg, c('--diff-add-bg'), c('--match-bg')),
    WCAG.TEXT,
  );
  check(
    '--text on a find match over a removed line',
    c('--text'),
    flatten(bg, c('--diff-del-bg'), c('--match-bg')),
    WCAG.TEXT,
  );
  check(
    '--match-active-fg on --match-active-bg',
    c('--match-active-fg'),
    c('--match-active-bg'),
    WCAG.TEXT,
  );

  // Occurrence highlights for the selected word, which stack on diff rows the
  // same way find hits do.
  check('--text on a selection match', c('--text'), flatten(bg, c('--selmatch-bg')), WCAG.TEXT);
  check(
    '--text on a selection match over an added line',
    c('--text'),
    flatten(bg, c('--diff-add-bg'), c('--selmatch-bg')),
    WCAG.TEXT,
  );
  check(
    '--text on a selection match over a removed line',
    c('--text'),
    flatten(bg, c('--diff-del-bg'), c('--selmatch-bg')),
    WCAG.TEXT,
  );

  // Anything that carries white `--on-emphasis` text has to stay dark enough.
  for (const fill of [
    '--success',
    '--success-hover',
    '--danger',
    '--danger-hover',
    '--warn',
    '--warn-hover',
    '--merged',
    '--draft',
    '--accent-fill',
    '--st-active-fill',
    '--st-pending-fill',
    '--st-resolved-fill',
    '--st-wontfix-fill',
    '--st-closed-fill',
  ]) {
    check(`--on-emphasis on ${fill}`, c('--on-emphasis'), c(fill), WCAG.TEXT);
  }

  // Semantic tones used as text rather than as a fill.
  for (const tone of ['--accent', '--add', '--del', '--green', '--st-rejected']) {
    check(`${tone} as text on --bg`, c(tone), bg, WCAG.TEXT);
    check(`${tone} as text on --panel`, c(tone), panel, WCAG.TEXT);
  }
  check('--st-active as text on --accent-bg', c('--st-active'), flatten(panel, c('--accent-bg')), WCAG.TEXT);
  check('--danger-fg on --danger-surface over --bg', c('--danger-fg'), flatten(bg, c('--danger-surface')), WCAG.TEXT);
  check('--danger-fg on --danger-surface over --panel', c('--danger-fg'), flatten(panel, c('--danger-surface')), WCAG.TEXT);

  // File-status squares and gutter badges: small, tinted, easy to get wrong.
  check('--fstat-mod-fg on --fstat-mod-bg', c('--fstat-mod-fg'), flatten(panel, c('--fstat-mod-bg')), WCAG.TEXT);
  check('--add on --fstat-add-bg', c('--add'), flatten(panel, c('--fstat-add-bg')), WCAG.TEXT);
  check('--del on --fstat-del-bg', c('--del'), flatten(panel, c('--fstat-del-bg')), WCAG.TEXT);
  check('--accent on --fstat-ren-bg', c('--accent'), flatten(panel, c('--fstat-ren-bg')), WCAG.TEXT);
  check(
    '--badge-resolved-fg on --badge-resolved-bg over an added line',
    c('--badge-resolved-fg'),
    flatten(addRow, c('--badge-resolved-bg')),
    WCAG.TEXT,
  );
  check('--badge-closed-fg on --badge-closed-bg', c('--badge-closed-fg'), c('--badge-closed-bg'), WCAG.TEXT);

  // Non-text: control outlines and the status rail down a thread's left edge.
  for (const [name, surface] of surfaces) {
    if (name === 'bg-3' || name === 'hover') continue;
    check(`--border-strong on --${name}`, c('--border-strong'), surface, WCAG.UI);
  }
  check('--accent-border on --panel', c('--accent-border'), panel, WCAG.UI);
  for (const tone of ['--st-active', '--st-pending', '--st-resolved', '--st-wontfix', '--st-closed']) {
    check(`${tone} rail on --panel`, c(tone), panel, WCAG.UI);
  }

  return results;
}

