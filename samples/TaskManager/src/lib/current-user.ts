// Who is signed in, resolved from the Office 365 Users connector ("Get my
// profile (V2)"). Best-effort and non-blocking: the board renders immediately,
// and any failure (no consent, connector unavailable, blank profile) resolves to
// null so the title bar simply shows nothing.

import { useQuery } from "@tanstack/react-query";
import { connectors } from "@/connectors";

export type CurrentUser = {
  /** The signed-in user's directory object id, when supplied. */
  id: string | null;
  /** Display name — never empty when present. */
  displayName: string;
  /** Primary address (mail, else UPN), used for the profile photo. */
  email: string | null;
  /** Raw `mail` from the profile, or null. */
  mail: string | null;
  /** Raw `userPrincipalName` from the profile, or null. */
  userPrincipalName: string | null;
};

export type CurrentUserState = {
  user: CurrentUser | null;
  isPending: boolean;
};

/** Trim a profile string, collapsing empties/whitespace to null. */
function clean(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * The identity to write to Azure DevOps [System.AssignedTo] for this user.
 *
 * `mail` and `userPrincipalName` can differ for the same person, and Azure
 * DevOps resolves identities by their unique name, which is normally the UPN.
 * So the UPN is preferred, with `mail` only as a fallback. Nothing is guessed
 * or transformed.
 */
export function adoWriteIdentity(user: CurrentUser | null): string | null {
  if (!user) return null;
  return user.userPrincipalName ?? user.mail ?? null;
}

/** Maps a raw profile into a CurrentUser, or null when it has no display name. */
export function toCurrentUser(profile: {
  id?: unknown;
  displayName?: unknown;
  mail?: unknown;
  userPrincipalName?: unknown;
} | null | undefined): CurrentUser | null {
  if (!profile) return null;
  const displayName = clean(profile.displayName);
  if (!displayName) return null;
  const mail = clean(profile.mail);
  const userPrincipalName = clean(profile.userPrincipalName);
  return {
    id: clean(profile.id),
    displayName,
    email: mail ?? userPrincipalName,
    mail,
    userPrincipalName,
  };
}

async function fetchCurrentUser(): Promise<CurrentUser | null> {
  try {
    const result = await connectors().office365Users.myProfile(
      "id,displayName,mail,userPrincipalName",
    );
    if (!result.success) return null;
    return toCurrentUser(result.data);
  } catch {
    return null;
  }
}

/** The signed-in user (null while loading and on every failure). Fetched once per session. */
export function useCurrentUserState(enabled: boolean): CurrentUserState {
  const { data, isPending } = useQuery({
    queryKey: ["o365-current-user"],
    queryFn: fetchCurrentUser,
    enabled,
    retry: false,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
  });
  return { user: data ?? null, isPending };
}

export function useCurrentUser(enabled: boolean): CurrentUser | null {
  return useCurrentUserState(enabled).user;
}
