import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WhitespaceNotice } from '../WhitespaceNotice';

const props = {
  hidden: 3,
  rawAdditions: 239,
  rawDeletions: 239,
  wholeFile: false,
  onShow: () => {},
};

describe('WhitespaceNotice', () => {
  it('says nothing when nothing is being hidden', () => {
    const { container } = render(<WhitespaceNotice {...props} hidden={0} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('announces how many lines are hidden', () => {
    render(<WhitespaceNotice {...props} />);
    expect(screen.getByRole('status')).toHaveTextContent('3 lines');
  });

  it('uses the singular for one line', () => {
    render(<WhitespaceNotice {...props} hidden={1} />);
    expect(screen.getByRole('status')).toHaveTextContent('1 line that changed');
  });

  it('keeps the true change counts discoverable', () => {
    render(<WhitespaceNotice {...props} />);
    expect(screen.getByRole('status')).toHaveTextContent('Full diff: +239 / −239.');
  });

  it('explains the whole-file case, which is the one that confuses reviewers', () => {
    render(<WhitespaceNotice {...props} hidden={239} wholeFile />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('This file was rewritten end to end');
    expect(status).toHaveTextContent('CRLF');
  });

  it('offers a one-click escape hatch back to the full diff', () => {
    const onShow = vi.fn();
    render(<WhitespaceNotice {...props} onShow={onShow} />);

    fireEvent.click(screen.getByRole('button', { name: /show whitespace changes/i }));

    expect(onShow).toHaveBeenCalledTimes(1);
  });
});
