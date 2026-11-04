import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MarkdownBody } from '../MarkdownBody';

describe('MarkdownBody suggestion blocks', () => {
  it('renders a ```suggestion block as a "Suggested change" diff (LF)', () => {
    const content = 'Please fix this.\n\n```suggestion\nconst fixed = true;\n```';
    const { container } = render(
      <MarkdownBody content={content} originalLine="const fixed = false;" lineNumber={10} />,
    );
    const block = container.querySelector('.suggestion-block');
    expect(block).not.toBeNull();
    expect(block?.textContent).toContain('Suggested change');
    expect(container.querySelector('.suggestion-block__line--add')?.textContent).toContain(
      'const fixed = true;',
    );
  });

  it('renders suggestion blocks even when the body uses CRLF line endings', () => {
    const content = 'Please fix this.\r\n\r\n```suggestion\r\nconst fixed = true;\r\n```';
    const { container } = render(<MarkdownBody content={content} />);
    const block = container.querySelector('.suggestion-block');
    expect(block).not.toBeNull();
    expect(container.querySelector('.suggestion-block__line--add')?.textContent).toContain(
      'const fixed = true;',
    );
  });

  it('renders plain markdown without a suggestion block', () => {
    const { container } = render(<MarkdownBody content="Just a normal comment." />);
    expect(container.querySelector('.suggestion-block')).toBeNull();
    expect(container.textContent).toContain('Just a normal comment.');
  });
});

describe('MarkdownBody safety', () => {
  it('drops javascript: link targets', () => {
    const { container } = render(<MarkdownBody content="[click](javascript:alert(1))" />);
    const link = container.querySelector('a');
    expect(link?.getAttribute('href') ?? '').not.toMatch(/^javascript:/i);
  });

  it('renders raw HTML as text rather than elements', () => {
    const { container } = render(
      <MarkdownBody content={'<img src="x" onerror="alert(1)"><script>alert(2)</script>'} />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
  });

  it('opens ordinary links in a new tab without an opener', () => {
    const { container } = render(<MarkdownBody content="[docs](https://example.com/docs)" />);
    const link = container.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://example.com/docs');
    expect(link?.getAttribute('rel')).toContain('noopener');
  });
});
