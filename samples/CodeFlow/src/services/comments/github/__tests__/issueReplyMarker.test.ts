import { describe, it, expect } from 'vitest';
import {
  encodeIssueReplyBody,
  decodeIssueReplyParent,
  stripIssueReply,
} from '../issueReplyMarker';

describe('issueReplyMarker', () => {
  it('round-trips the parent id through encode/decode', () => {
    const encoded = encodeIssueReplyBody('Looks good to me', '12345', 'alice');
    expect(decodeIssueReplyParent(encoded)).toBe('12345');
  });

  it('names the parent author so the reply reads as a reply on GitHub', () => {
    const encoded = encodeIssueReplyBody('sure', '9', 'octocat');
    expect(encoded).toContain('In reply to **@octocat**');
  });

  it('falls back to a generic attribution when the author is unknown', () => {
    const encoded = encodeIssueReplyBody('sure', '9');
    expect(encoded).toContain('In reply to an earlier comment');
    expect(decodeIssueReplyParent(encoded)).toBe('9');
  });

  it('strips the whole marker block, leaving only the reply text', () => {
    const encoded = encodeIssueReplyBody('Fixed in the latest push', '77', 'bob');
    expect(stripIssueReply(encoded)).toBe('Fixed in the latest push');
  });

  it('preserves multi-line reply bodies', () => {
    const body = 'First line\n\n- a\n- b';
    expect(stripIssueReply(encodeIssueReplyBody(body, '1', 'a'))).toBe(body);
  });

  it('leaves a body without a marker untouched', () => {
    expect(decodeIssueReplyParent('just a comment')).toBeNull();
    expect(stripIssueReply('just a comment')).toBe('just a comment');
  });

  it('only strips a marker at the start, not a quoted one mid-body', () => {
    const body = 'see this: <!-- codeflow:reply-to id=5 -->';
    expect(stripIssueReply(body)).toBe(body);
  });
});
