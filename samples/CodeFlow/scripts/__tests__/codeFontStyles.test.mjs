import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const css = readFileSync(resolve(process.cwd(), 'src', 'App.css'), 'utf8');

describe('code surface styles', () => {
  it('wires both diff layouts, snippets, suggestions, search and preview to the preferences', () => {
    const dom = new JSDOM(`<!doctype html><style>${css}</style>
      <table class="diff__table diff__table--inline"></table>
      <table class="diff__table diff__table--split"></table>
      <div class="markdown-body"><code></code><pre><code></code></pre></div>
      <table class="suggestion-block__diff"></table>
      <button class="results__hit"></button>
      <pre class="set__code-preview"></pre>
      <span class="diff__filename"></span>
    `);
    try {
      const { document, getComputedStyle } = dom.window;
      const surfaces = document.querySelectorAll(
        '.diff__table, .markdown-body code, .suggestion-block__diff, .results__hit, .set__code-preview',
      );
      expect(surfaces).toHaveLength(7);
      for (const surface of surfaces) {
        const style = getComputedStyle(surface);
        expect(style.fontFamily).toContain('var(--code-font-family,');
        expect(style.fontVariantLigatures).toBe('var(--code-font-ligatures, normal)');
        expect(style.fontFeatureSettings).toBe('var(--code-font-features, normal)');
      }
      expect(getComputedStyle(document.querySelector('.diff__filename')).fontFamily)
        .toBe('var(--mono)');
    } finally {
      dom.window.close();
    }
  });
});
