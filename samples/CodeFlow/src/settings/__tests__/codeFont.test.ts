import { afterEach, describe, expect, it } from 'vitest';
import { applyCodeFontToDocument, CODE_FONTS, CODE_FONT_NAMES } from '../codeFont';

afterEach(() => {
  applyCodeFontToDocument('default', true);
});

describe('applyCodeFontToDocument', () => {
  it('applies each offered family with a local monospace fallback', () => {
    for (const font of CODE_FONT_NAMES) {
      applyCodeFontToDocument(font, true);
      expect(document.documentElement.style.getPropertyValue('--code-font-family'))
        .toBe(CODE_FONTS[font].family);
      if (font !== 'default') expect(CODE_FONTS[font].family).toMatch(/, monospace$/);
    }
  });

  it('disables contextual alternates as well as all classes of ligatures', () => {
    applyCodeFontToDocument('cascadia-code', false);
    const { style } = document.documentElement;
    expect(style.getPropertyValue('--code-font-ligatures')).toBe('none');
    expect(style.getPropertyValue('--code-font-features'))
      .toBe('"liga" 0, "clig" 0, "dlig" 0, "hlig" 0, "calt" 0');

    applyCodeFontToDocument('consolas', false);
    expect(style.getPropertyValue('--code-font-ligatures')).toBe('none');
    expect(style.getPropertyValue('--code-font-features')).toContain('"calt" 0');
  });

  it('does not replace UI typography and removes the font override when default is chosen', () => {
    document.documentElement.style.setProperty('--mono', 'original-mono');
    document.documentElement.style.setProperty('--font-ui', 'original-ui');
    try {
      applyCodeFontToDocument('menlo', false);
      applyCodeFontToDocument('default', true);
      const { style } = document.documentElement;
      expect(style.getPropertyValue('--code-font-family')).toBe('');
      expect(style.getPropertyValue('--mono')).toBe('original-mono');
      expect(style.getPropertyValue('--font-ui')).toBe('original-ui');
      expect(style.getPropertyValue('--code-font-ligatures')).toBe('normal');
      expect(style.getPropertyValue('--code-font-features')).toBe('normal');
    } finally {
      document.documentElement.style.removeProperty('--mono');
      document.documentElement.style.removeProperty('--font-ui');
    }
  });
});
