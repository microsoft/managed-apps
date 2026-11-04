import { describe, it, expect } from 'vitest';
import { TOKEN_KINDS, SYNTAX_THEME, SYNTAX_THEME_NAME, kindForColor, tokenClass } from '../tokens';

describe('the sentinel theme', () => {
  it('paints exactly one rule per kind', () => {
    expect(SYNTAX_THEME.settings).toHaveLength(TOKEN_KINDS.length);
  });

  it('round-trips every kind through its sentinel colour', () => {
    // This is the contract the whole engine seam rests on: if a sentinel ever
    // collided or drifted, tokens would silently come back as the wrong kind.
    SYNTAX_THEME.settings.forEach((rule, i) => {
      expect(kindForColor(rule.settings.foreground)).toBe(TOKEN_KINDS[i]);
    });
  });

  it('gives every kind a distinct colour', () => {
    const colors = SYNTAX_THEME.settings.map((r) => r.settings.foreground);
    expect(new Set(colors).size).toBe(colors.length);
  });

  it('never lets a sentinel double as the plain foreground', () => {
    const colors = SYNTAX_THEME.settings.map((r) => r.settings.foreground);
    expect(colors).not.toContain(SYNTAX_THEME.fg);
    expect(kindForColor(SYNTAX_THEME.fg)).toBeNull();
  });

  it('assigns no scope to two kinds at once', () => {
    const scopes = SYNTAX_THEME.settings.flatMap((r) => r.scope);
    expect(new Set(scopes).size).toBe(scopes.length);
  });

  it('exposes its name for the engine to register under', () => {
    expect(SYNTAX_THEME_NAME).toBe(SYNTAX_THEME.name);
  });
});

describe('kindForColor', () => {
  it('tolerates the hex casing grammars actually emit', () => {
    const first = SYNTAX_THEME.settings[0].settings.foreground;
    expect(kindForColor(first.toUpperCase())).toBe(TOKEN_KINDS[0]);
  });

  it('returns null for anything it does not recognise', () => {
    expect(kindForColor(undefined)).toBeNull();
    expect(kindForColor('')).toBeNull();
    expect(kindForColor('#ff7b72')).toBeNull();
  });
});

describe('tokenClass', () => {
  it('emits a shared hook plus a per-kind class', () => {
    expect(tokenClass('keyword')).toBe('tok tok--keyword');
  });

  it('covers every kind', () => {
    for (const kind of TOKEN_KINDS) expect(tokenClass(kind)).toBe(`tok tok--${kind}`);
  });
});
