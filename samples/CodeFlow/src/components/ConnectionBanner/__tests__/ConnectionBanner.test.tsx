import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ConnectionBanner } from '../ConnectionBanner';

describe('ConnectionBanner', () => {
  it('names the real cause rather than repeating GitHub’s misleading wording', () => {
    render(<ConnectionBanner kind="unauthenticated" />);

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(/cannot sign in to GitHub as you/i)).toBeTruthy();
    expect(screen.getByText(/without your credentials/i)).toBeTruthy();
  });

  it('says the fault will not clear itself, because waiting is the wrong instinct', () => {
    render(<ConnectionBanner kind="unauthenticated" />);
    expect(screen.getByText(/will not clear on its own/i)).toBeTruthy();
  });

  it('tells the reviewer how to repair the connection', () => {
    render(<ConnectionBanner kind="unauthenticated" />);
    expect(screen.getByText(/Reconnect or recreate it/i)).toBeTruthy();
  });

  it('never offers a self-service link that the reviewer would be denied', () => {
    render(<ConnectionBanner kind="unauthenticated" onRetry={vi.fn()} />);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('treats a genuine quota as temporary', () => {
    render(<ConnectionBanner kind="rate-limited" />);

    expect(screen.getByText(/hit GitHub's rate limit/i)).toBeTruthy();
    expect(screen.getByText(/reset shortly/i)).toBeTruthy();
  });

  it('lets the reviewer retry once they believe it is fixed', () => {
    const onRetry = vi.fn();
    render(<ConnectionBanner kind="unauthenticated" onRetry={onRetry} />);

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
