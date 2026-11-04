import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RenameNotice } from '../RenameNotice';
import { getRenameInfo } from '../../../utils/renameInfo';
import type { FileChange } from '../../../types';

function moved(overrides: Partial<FileChange> = {}) {
  return getRenameInfo({
    filename: 'dashboards/adx/kpi.json',
    previousFilename: 'docs/adx/kpi.json',
    status: 'renamed',
    additions: 0,
    deletions: 0,
    changes: 0,
    ...overrides,
  });
}

describe('RenameNotice', () => {
  it('renders nothing for a file that did not move', () => {
    const { container } = render(<RenameNotice info={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it('names the kind of change rather than just "renamed"', () => {
    render(<RenameNotice info={moved()} />);
    expect(screen.getByText('Moved')).toBeTruthy();
  });

  it('says the contents are identical when only the path changed', () => {
    render(<RenameNotice info={moved()} />);
    expect(document.body.textContent).toContain('only the file path changed');
  });

  it('says the contents changed too when they did', () => {
    render(<RenameNotice info={moved({ additions: 2, deletions: 1, changes: 3 })} />);
    expect(document.body.textContent).toContain('so did its contents');
  });

  it('shows both paths in full, since the old folder is the whole change', () => {
    render(<RenameNotice info={moved()} />);
    expect(screen.getByText('docs/adx/kpi.json')).toBeTruthy();
    expect(screen.getByText('dashboards/adx/kpi.json')).toBeTruthy();
  });

  it('spells out the arrow for a screen reader, which would otherwise skip it', () => {
    render(<RenameNotice info={moved()} />);
    const spoken = document.body.querySelector('.u-sronly');
    expect(spoken?.textContent).toContain('moved to');
  });

  it('announces itself as a status, so it is not silently skipped', () => {
    render(<RenameNotice info={moved()} />);
    expect(screen.getByRole('status')).toBeTruthy();
  });
});
