import type { DeepLinkTarget } from '../../utils/deepLink';

/** `owner/repo#123` for the splash headline. */
export function describeSplashTarget(target: DeepLinkTarget): string {
  return `${target.owner}/${target.repo}#${target.number}`;
}

/** Secondary line naming the file or comment the target points at, if any. */
export function describeSplashDetail(target: DeepLinkTarget): string {
  if (target.file) {
    const name = target.file.split('/').pop() || target.file;
    return target.commentId ? `Jumping to a comment in ${name}` : `Jumping to ${name}`;
  }
  if (target.commentId) return 'Jumping to a comment';
  return 'Fetching pull request details…';
}
