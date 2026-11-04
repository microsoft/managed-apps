import { PersonAvatar as EngineerAvatar } from "@/components/person-avatar";
import { type CurrentUser } from "@/lib/current-user";
import { usePersonPhotos } from "@/lib/people-photos";

/**
 * "Signed in as <Display Name>" — the title bar's identity line.
 *
 * The name comes from a real Office 365 Users profile call (useCurrentUser);
 * nothing is hardcoded or inferred. When it hasn't resolved — still loading, no
 * consent, connector failure, or a profile with no display name — this renders
 * NOTHING at all rather than a placeholder or a fabricated name.
 *
 * Their profile photo rides along for free through the same helper the board
 * avatars use (initials fallback included), and only when the profile carried
 * an address to look it up with.
 */
export function SignedInAs({ user }: { user: CurrentUser | null }) {
  const photos = usePersonPhotos(user?.email ? [user.email] : []);
  if (!user) return null;
  const photoUrl = user.email
    ? photos[user.email.trim().toLowerCase()]
    : undefined;

  return (
    <div
      className="flex min-w-0 shrink cursor-default select-none items-center gap-1.5 px-1.5 text-white"
      title={user.email ? `${user.displayName} · ${user.email}` : user.displayName}
    >
      <EngineerAvatar name={user.displayName} photoUrl={photoUrl} />
      <span className="min-w-0 truncate text-[11px]">
        Signed in as <span className="font-bold">{user.displayName}</span>
      </span>
    </div>
  );
}
