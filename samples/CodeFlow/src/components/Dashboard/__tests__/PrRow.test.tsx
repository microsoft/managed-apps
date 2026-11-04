import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../../state/useCodeFlow', () => ({
  useCodeFlow: () => ({ state: {}, actions: {} }),
}));

vi.mock('../../../services/githubService', () => ({
  GitHubService: {
    searchPullRequests: vi.fn(async () => []),
    getAuthenticatedUser: vi.fn(async () => undefined),
  },
}));

vi.mock('../../../state/hooks/useReviewStateRevision', () => ({
  useReviewStateRevision: () => '0',
}));

import { PrRow } from '../Dashboard';
import type { PrListItem } from '../../../types';
import { buildDeepLink } from '../../../utils/deepLink';
import { absoluteTime } from '../../../utils/format';

function makeItem(overrides: Partial<PrListItem> = {}): PrListItem {
  return {
    coordinates: { owner: 'octo', name: 'repo', number: 42 },
    title: 'My PR',
    ...overrides,
  };
}

describe('PrRow middle-click', () => {
  let openSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
  });

  afterEach(() => {
    openSpy.mockRestore();
  });

  it('opens the CodeFlow deep link in a new tab on middle-click', () => {
    const item = makeItem();
    render(<PrRow item={item} onOpen={vi.fn()} onFlag={vi.fn()} />);
    const btn = screen.getByTitle('My PR');
    btn.dispatchEvent(new MouseEvent('auxclick', { button: 1, bubbles: true }));
    const expectedUrl = buildDeepLink({ owner: 'octo', repo: 'repo', number: 42 });
    expect(openSpy).toHaveBeenCalledWith(expectedUrl, '_blank', 'noopener,noreferrer');
  });

  it('does not call window.open for non-middle-button auxclick', () => {
    const item = makeItem();
    render(<PrRow item={item} onOpen={vi.fn()} onFlag={vi.fn()} />);
    const btn = screen.getByTitle('My PR');
    btn.dispatchEvent(new MouseEvent('auxclick', { button: 2, bubbles: true }));
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('does not call onOpen when the button is middle-clicked', () => {
    const onOpen = vi.fn();
    const item = makeItem();
    render(<PrRow item={item} onOpen={onOpen} onFlag={vi.fn()} />);
    const btn = screen.getByTitle('My PR');
    btn.dispatchEvent(new MouseEvent('auxclick', { button: 1, bubbles: true }));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('suppresses the default mousedown action so autoscroll never engages', () => {
    const item = makeItem();
    render(<PrRow item={item} onOpen={vi.fn()} onFlag={vi.fn()} />);
    const btn = screen.getByTitle('My PR');
    const down = new MouseEvent('mousedown', { button: 1, bubbles: true, cancelable: true });
    btn.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
  });

  it('leaves left-button mousedown alone', () => {
    const item = makeItem();
    render(<PrRow item={item} onOpen={vi.fn()} onFlag={vi.fn()} />);
    const btn = screen.getByTitle('My PR');
    const down = new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true });
    btn.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(false);
  });
});

describe('PrRow meta tooltip', () => {
  it('reveals the full datetime when you hover the relative time', () => {
    const updatedAt = '2024-03-05T14:30:00Z';
    const { container } = render(
      <PrRow
        item={makeItem({ updatedAt })}
        meta="updated 2h ago"
        metaTitle={absoluteTime(updatedAt)}
        onOpen={vi.fn()}
        onFlag={vi.fn()}
      />,
    );
    const time = container.querySelector('.prrow__time');
    expect(time?.textContent).toBe('updated 2h ago');
    expect(time?.getAttribute('title')).toBe(absoluteTime(updatedAt));
  });

  it('leaves the tooltip off when the meta is not a timestamp', () => {
    const { container } = render(
      <PrRow item={makeItem()} meta="you are a reviewer" onOpen={vi.fn()} onFlag={vi.fn()} />,
    );
    const time = container.querySelector('.prrow__time');
    expect(time?.hasAttribute('title')).toBe(false);
  });
});
