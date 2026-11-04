import { render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { buildFullFileDiff } from '../../diffParser';
import { useSyntaxHighlight } from '../../../components/DiffViewer/useSyntaxHighlight';
import { renderCell } from '../../../components/DiffViewer/renderCell';

describe('large full-file syntax with the real engine', () => {
  it.each(['inline', 'split'] as const)('colors both revisions past the former cutoff in %s view', async (viewMode) => {
    const lines = ['/* opening', ...Array.from({ length: 4998 }, () => 'inside the comment'), '*/', 'const value = "new";'];
    const diff = buildFullFileDiff('@@ -5001 +5001 @@\n-const value = "old";\n+const value = "new";', lines.join('\n'));

    function Cells() {
      const syntax = useSyntaxHighlight(diff, viewMode, 'both', 'large.ts', true);
      const oldColumn = viewMode === 'inline' ? 'inline' : 'left';
      const newColumn = viewMode === 'inline' ? 'inline' : 'right';
      return (
        <div data-testid="syntax" data-active={syntax.active} data-deferred={syntax.deferRendering}>
          <div data-testid="comment">
            {renderCell(lines[4000], [], syntax.tokensFor(newColumn, viewMode === 'inline' ? '0-4000' : '4000'), syntax.deferRendering)}
          </div>
          <div data-testid="old">
            {renderCell('const value = "old";', [], syntax.tokensFor(oldColumn, viewMode === 'inline' ? '0-5000' : '5000'), syntax.deferRendering)}
          </div>
          <div data-testid="new">
            {renderCell(lines[5000], [], syntax.tokensFor(newColumn, viewMode === 'inline' ? '0-5001' : '5000'), syntax.deferRendering)}
          </div>
        </div>
      );
    }

    const { getByTestId } = render(<Cells />);
    expect(getByTestId('syntax').dataset.active).toBe('true');
    expect(getByTestId('syntax').dataset.deferred).toBe('true');
    await waitFor(() => expect(getByTestId('new').querySelector('.tok--string')?.textContent).toBe('"new"'), { timeout: 15000 });
    expect(getByTestId('old').querySelector('.tok--string')?.textContent).toBe('"old"');
    expect(getByTestId('new').querySelector('.tok--keyword')?.textContent).toBe('const');
    expect(getByTestId('comment').querySelector('.tok--comment')?.textContent).toBe(lines[4000]);
  }, 20000);
});
