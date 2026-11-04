import { hashString, initials } from '../lib/format';
import type { Presenter } from '../lib/pastSessions';
import { usePhoto, useProfile } from '../lib/people';
import { href, paths } from '../lib/router';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const TINTS = 6;

interface AvatarProps {
  /** Directory user id; omit for people outside the directory (initials only). */
  userId?: string;
  name: string;
  size?: AvatarSize;
  className?: string;
  /** Skip the photo lookup (e.g. transient search results). */
  noPhoto?: boolean;
}

/** Profile photo via the users directory adapter, with an initials fallback. */
export function Avatar({ userId, name, size = 'sm', className, noPhoto }: AvatarProps) {
  const photo = usePhoto(noPhoto ? undefined : userId);
  const url = photo.data;
  const tint = hashString((userId || name).toLowerCase()) % TINTS;
  return (
    <span
      className={`avatar avatar--${size} avatar--tint${tint}${className ? ` ${className}` : ''}`}
      role="img"
      aria-label={name}
    >
      {url ? <img src={url} alt="" draggable={false} /> : <span aria-hidden="true">{initials(name)}</span>}
    </span>
  );
}

/** Uses the directory display name when the stored snapshot name is missing. */
function usePresenterName(presenter: Presenter): string {
  const profile = useProfile(presenter.name ? undefined : presenter.id);
  return presenter.name || profile.data?.displayName || 'Unknown person';
}

function PresenterName({ presenter, link }: { presenter: Presenter; link: boolean }) {
  const name = usePresenterName(presenter);
  if (!link || !presenter.id) return <>{name}</>;
  return (
    <a className="person-link" href={href(paths.person(presenter.id))}>
      {name}
    </a>
  );
}

interface PresenterListProps {
  presenters: Presenter[];
  size?: AvatarSize;
  link?: boolean;
  /** Max names shown before "and N others". */
  maxNames?: number;
  emptyLabel?: string;
}

/** Overlapping avatars followed by the presenters' names. */
export function PresenterList({ presenters, size = 'sm', link = true, maxNames = 3, emptyLabel }: PresenterListProps) {
  if (presenters.length === 0) {
    return emptyLabel ? <p className="presenters presenters--empty">{emptyLabel}</p> : null;
  }
  const shown = presenters.slice(0, maxNames);
  const hidden = presenters.length - shown.length;
  const parts = shown.map((p) => <PresenterName key={p.id || p.name} presenter={p} link={link} />);
  return (
    <div className="presenters">
      <span className={`avatar-stack avatar-stack--${size}`}>
        {presenters.slice(0, 4).map((p) => (
          <Avatar key={p.id || p.name} userId={p.id} name={p.name} size={size} />
        ))}
      </span>
      <span className="presenters__names">
        {parts.map((part, i) => (
          <span key={i}>
            {i > 0 && (i === parts.length - 1 && hidden === 0 ? (parts.length > 2 ? ', and ' : ' and ') : ', ')}
            {part}
          </span>
        ))}
        {hidden > 0 && <span>{` and ${hidden} ${hidden === 1 ? 'other' : 'others'}`}</span>}
      </span>
    </div>
  );
}
