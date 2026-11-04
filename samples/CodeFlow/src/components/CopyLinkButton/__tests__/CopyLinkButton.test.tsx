import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CopyLinkButton } from '../CopyLinkButton';

const copyToClipboard = vi.fn();
const copyRichLink = vi.fn();
vi.mock('../../../utils/deepLink', () => ({
  copyToClipboard: (...a: unknown[]) => copyToClipboard(...a),
  copyRichLink: (...a: unknown[]) => copyRichLink(...a),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CopyLinkButton', () => {
  it('copies the link and reports success', async () => {
    copyToClipboard.mockResolvedValue(true);
    render(
      <CopyLinkButton
        link="https://apps.example.com/codeflow?org=o&repo=r&pull=12"
        title="Copy link to this PR"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Copy link to this PR' }));

    expect(copyToClipboard).toHaveBeenCalledWith(
      'https://apps.example.com/codeflow?org=o&repo=r&pull=12',
    );
    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('Copied'));
  });

  it('copies a rich ADO-style link when prNumber and prTitle are provided', async () => {
    copyRichLink.mockResolvedValue(true);
    render(
      <CopyLinkButton
        link="https://apps.example.com/codeflow?org=o&repo=r&pull=42"
        title="Copy link to this PR"
        prNumber={42}
        prTitle="Fix the widget"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Copy link to this PR' }));

    expect(copyRichLink).toHaveBeenCalledWith(
      'https://apps.example.com/codeflow?org=o&repo=r&pull=42',
      'Pull Request 42: Fix the widget',
    );
    expect(copyToClipboard).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('Copied'));
  });

  it('reports failure when the clipboard is blocked', async () => {
    copyToClipboard.mockResolvedValue(false);
    render(<CopyLinkButton link="https://player/apps/x" />);

    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('Failed'));
  });

  it('is disabled without a link', () => {
    render(<CopyLinkButton link="" />);
    const btn = screen.getByRole('button');
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(copyToClipboard).not.toHaveBeenCalled();
  });

  it('renders a custom glyph instead of the link icon', async () => {
    copyToClipboard.mockResolvedValue(true);
    render(<CopyLinkButton link="https://github.com/o/r/pull/1" label="GH" />);
    const btn = screen.getByRole('button');
    expect(btn).toHaveTextContent('GH');

    fireEvent.click(btn);
    await waitFor(() => expect(btn).toHaveTextContent('Copied'));
  });
});
