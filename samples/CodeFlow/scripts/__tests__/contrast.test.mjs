import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  auditPalette,
  composite,
  contrastRatio,
  flatten,
  parseColor,
  parseThemeTokens,
  ratio,
  relativeLuminance,
  tokenColor,
} from '../contrastCore.mjs';

const css = readFileSync(resolve(process.cwd(), 'src/App.css'), 'utf8');
const themes = parseThemeTokens(css);

describe('parseColor', () => {
  it('reads 6- and 3-digit hex', () => {
    expect(parseColor('#ffffff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor('#000')).toEqual({ r: 0, g: 0, b: 0, a: 1 });
  });

  it('reads rgb() and rgba() including fractional alpha', () => {
    expect(parseColor('rgb(1, 2, 3)')).toEqual({ r: 1, g: 2, b: 3, a: 1 });
    expect(parseColor('rgba(255, 255, 255, 0.09)')).toEqual({ r: 255, g: 255, b: 255, a: 0.09 });
  });

  it('returns null for values that are not colours', () => {
    expect(parseColor('var(--text)')).toBeNull();
    expect(parseColor('none')).toBeNull();
  });
});

describe('relativeLuminance and contrastRatio', () => {
  it('anchors on the WCAG reference values', () => {
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 5);
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBeCloseTo(0, 5);
    expect(contrastRatio({ r: 255, g: 255, b: 255 }, { r: 0, g: 0, b: 0 })).toBeCloseTo(21, 5);
  });

  it('is symmetric, so argument order cannot change a verdict', () => {
    const a = parseColor('#1b2027');
    const b = parseColor('#adbac7');
    expect(ratio(a, b)).toBe(ratio(b, a));
  });

  it('reports 1 for a colour against itself', () => {
    expect(ratio(parseColor('#57ab5a'), parseColor('#57ab5a'))).toBe(1);
  });
});

describe('composite', () => {
  it('leaves the backdrop untouched at zero alpha', () => {
    const backdrop = parseColor('#1b2027');
    expect(composite(parseColor('rgba(255,255,255,0)'), backdrop)).toMatchObject({ r: 27, g: 32, b: 39 });
  });

  it('replaces the backdrop at full alpha', () => {
    const out = composite(parseColor('#ffffff'), parseColor('#1b2027'));
    expect(out).toMatchObject({ r: 255, g: 255, b: 255 });
  });

  it('blends layers in paint order, so stacking is not commutative', () => {
    const base = parseColor('#000000');
    const green = parseColor('rgba(0,255,0,0.5)');
    const red = parseColor('rgba(255,0,0,0.5)');
    expect(flatten(base, green, red)).not.toEqual(flatten(base, red, green));
  });
});

describe('parseThemeTokens', () => {
  it('finds every theme the app can render', () => {
    expect([...themes.keys()].sort()).toEqual(['dark', 'dogfood', 'light']);
  });

  it('gives all themes the same colour vocabulary, so no theme silently inherits', () => {
    // Compared on colour tokens only: the dark block doubles as `:root`, so it
    // also carries non-colour tokens (fonts, shadows) the others do not repeat.
    const colourNames = (theme) =>
      [...themes.get(theme).entries()]
        .filter(([, value]) => parseColor(value) !== null)
        .map(([name]) => name)
        .sort();
    const dark = colourNames('dark');
    for (const name of ['light', 'dogfood']) {
      expect(colourNames(name), `${name} token set`).toEqual(dark);
    }
  });

  it('throws a useful error rather than skipping an unknown token', () => {
    expect(() => tokenColor(themes.get('dark'), '--not-a-token')).toThrow(/missing token/);
  });
});

// The dogfood easter egg is deliberately garish and is exempt by design.
describe.each(['dark', 'light'])('%s palette', (theme) => {
  const results = auditPalette(themes.get(theme));

  it('renders every foreground/background pair at its WCAG minimum', () => {
    const failures = results
      .filter((r) => !r.pass)
      .map((r) => `${r.label}: ${r.ratio}:1 (needs ${r.min}:1)`);
    expect(failures).toEqual([]);
  });

  it('audits a meaningful number of pairs', () => {
    expect(results.length).toBeGreaterThan(60);
  });

  it('keeps body text below the halation threshold that caused eye strain', () => {
    // Contrast this far above AAA makes glyph edges bloom on a dark field. The
    // ceiling only applies to dark themes: dark-on-light does not halate, so
    // the light palette is deliberately allowed to sit at its natural ~15:1.
    //
    // It is checked against *every* surface that carries body text, not just
    // --bg: a recessed well like --input-bg is darker than the canvas, so it
    // is the first place halation reappears when --text is brightened.
    const tokens = themes.get(theme);
    const text = tokenColor(tokens, '--text');
    const surfaces = ['--bg', '--bg-2', '--bg-3', '--panel', '--panel-2', '--input-bg', '--page-grad'];
    const isDark = relativeLuminance(tokenColor(tokens, '--bg')) < 0.5;

    expect(ratio(text, tokenColor(tokens, '--bg'))).toBeGreaterThanOrEqual(7);
    if (!isDark) return;

    const halating = surfaces
      .map((s) => [s, ratio(text, tokenColor(tokens, s))])
      .filter(([, r]) => r > 10)
      .map(([s, r]) => `${s}: ${r}:1`);
    expect(halating).toEqual([]);
  });
});

describe('App.css', () => {
  /** Every `selector { ... }` block, ignoring at-rule preludes. */
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
    selector: selector.trim().split('\n').pop().trim(),
    body,
  }));

  it('defines colours only in the theme blocks, so the audit sees the whole palette', () => {
    // Everything after the last theme block must reach for a var(); a literal
    // colour here would be invisible to auditPalette().
    const start = css.indexOf('/* ----------------------------- Focus');
    expect(start, 'the Focus section marker moved — this test is slicing nothing').toBeGreaterThan(0);
    const hardCoded = css.slice(start).match(/(?<![-\w])#[0-9a-fA-F]{3,8}\b|rgba?\(/g) ?? [];
    expect(hardCoded).toEqual([]);
  });

  it('never paints white --on-emphasis text on a foreground-tuned status colour', () => {
    // The --st-* tones are tuned to be readable *as text*; their -fill twins are
    // the only ones dark enough to sit under white. Mixing them up is the exact
    // regression this pair of token families exists to prevent.
    const statusRules = css.match(/\.thread__status--\w+\s*\{[^}]*\}/g) ?? [];
    expect(statusRules.length).toBeGreaterThan(0);
    for (const rule of statusRules) {
      if (!/--on-emphasis/.test(rule)) continue;
      expect(rule, rule).toMatch(/background:\s*var\(--st-\w+-fill\)/);
    }
  });

  it('gives keyboard users a focus ring on every interactive element', () => {
    expect(css).toMatch(/:where\([^)]*button[^)]*\):focus-visible\s*\{[^}]*outline:/);
  });

  it('keeps the add-comment chip out of the code you select', () => {
    // In split view the chip has to live inside the code cell, so without this
    // its `+` joins the line: select and copy a row and you get `+const foo…`,
    // and a drag from the start of a line grabs the plus before the code.
    const rule = rules.find((r) => r.selector === '.diff__addcomment');
    expect(rule, 'the .diff__addcomment rule moved').toBeTruthy();
    expect(rule.body).toMatch(/user-select:\s*none/);
  });

  it('only suppresses a focus outline where a wrapper draws one instead', () => {
    // A bare `outline: none` on :focus is the classic WCAG 2.4.7 failure. The
    // few opt-outs left are inputs whose wrapper carries the ring, so they are
    // written as :focus-visible and must stay that way.
    const suppressors = rules.filter((r) => /outline:\s*none/.test(r.body));
    expect(suppressors.length).toBeGreaterThan(0);
    for (const rule of suppressors) {
      expect(rule.selector, rule.selector).toMatch(/:focus-visible$/);
    }
    for (const rule of suppressors) {
      const base = rule.selector.replace(/:focus-visible$/, '');
      // The ring lives on an ancestor block: `.md-editor__textarea` is wrapped
      // by `.md-editor`, `.diff__search-input` by `.diff__search-field`.
      const candidates = [base.replace(/__[\w-]+$/, ''), base.replace(/-[\w]+$/, '')];
      const ringed = candidates.some((prefix) =>
        new RegExp(`${prefix.replace(/\./g, '\\.')}[\\w-]*:has\\([^)]*:focus-visible\\)`).test(css),
      );
      expect(ringed, `${base} suppresses its outline but no wrapper draws one`).toBe(true);
    }
  });

  it('keeps every font-size at or above an 11px floor', () => {
    const sizes = [...css.matchAll(/font-size:\s*(\d+)px/g)].map(([, px]) => Number(px));
    expect(sizes.length).toBeGreaterThan(50);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(11);
  });

  it('gives icon-only buttons a 24px target', () => {
    for (const selector of ['.iconbtn', '.copy-link-btn']) {
      const rule = rules.find((r) => r.selector === selector);
      expect(rule, selector).toBeDefined();
      expect(rule.body, selector).toMatch(/min-width:\s*24px/);
      expect(rule.body, selector).toMatch(/min-height:\s*24px/);
    }
  });

  it('grows the inline add-comment button past its visual size', () => {
    // It sits inside a diff row, so it cannot get bigger without shifting the
    // code; the transparent ::before is what makes the target 24px.
    const rule = rules.find((r) => r.selector === '.diff__addcomment::before');
    expect(rule).toBeDefined();
    expect(rule.body).toMatch(/width:\s*24px/);
    expect(rule.body).toMatch(/height:\s*24px/);
  });
});
