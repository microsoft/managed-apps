import type { GitUserRef } from '../types';
import { initials, avatarColors } from '../utils/format';

interface AvatarProps {
  user?: GitUserRef;
  size?: number;
  title?: string;
}

/**
 * Small circular avatar generated from the user's initials over a deterministic
 * color. We intentionally do not load remote avatar images: the deployed app's
 * CSP blocks GitHub's avatar host, so `<img>` tags render broken. Generating the
 * avatar locally keeps it working everywhere and stays stable per user.
 */
export function Avatar({ user, size = 20, title }: AvatarProps) {
  const label = user?.name || user?.login || 'unknown';
  const seed = user?.login || user?.name || label;
  const { background, color } = avatarColors(seed);
  const style = {
    width: size,
    height: size,
    fontSize: Math.round(size * 0.42),
    background,
    color,
  };
  return (
    <span className="avatar avatar--initials" style={style} title={title ?? label}>
      {initials(label)}
    </span>
  );
}
