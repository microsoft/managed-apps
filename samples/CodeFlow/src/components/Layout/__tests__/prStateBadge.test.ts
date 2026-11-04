import { describe, it, expect } from 'vitest';
import { prStateBadge } from '../prStateBadge';

describe('prStateBadge', () => {
  it('gives a draft its own modifier instead of the open one', () => {
    // The bug this exists to stop: the chip read "Draft" while wearing the
    // green `open` fill, so a draft looked ready for review.
    expect(prStateBadge({ merged: false, draft: true, state: 'open' })).toEqual({
      label: 'Draft',
      modifier: 'draft',
    });
  });

  it('labels an ordinary open pull request Open', () => {
    expect(prStateBadge({ merged: false, draft: false, state: 'open' })).toEqual({
      label: 'Open',
      modifier: 'open',
    });
  });

  it('lets merged win over everything', () => {
    expect(prStateBadge({ merged: true, draft: false, state: 'closed' }).modifier).toBe('merged');
  });

  it('lets closed win over draft, because a closed draft is closed', () => {
    expect(prStateBadge({ merged: false, draft: true, state: 'closed' })).toEqual({
      label: 'Closed',
      modifier: 'closed',
    });
  });

  it('keeps the label and the modifier in step for every state', () => {
    for (const pr of [
      { merged: true, draft: false, state: 'closed' as const },
      { merged: false, draft: true, state: 'open' as const },
      { merged: false, draft: false, state: 'open' as const },
      { merged: false, draft: false, state: 'closed' as const },
    ]) {
      const badge = prStateBadge(pr);
      expect(badge.label.toLowerCase()).toBe(badge.modifier);
    }
  });
});
