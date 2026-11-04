import { queryOptions, useQuery } from '@tanstack/react-query';
import { useUsersDirectory, type DirectoryUser, type UsersDirectory } from '../connectors/users';

export type Profile = DirectoryUser;

export function profileQuery(directory: UsersDirectory, id: string) {
  return queryOptions({
    queryKey: ['profile', id] as const,
    queryFn: () => directory.getUser(id),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });
}

/** Directory profile for a user id, cached for the session. Disabled for an empty id. */
export function useProfile(id: string | undefined) {
  const directory = useUsersDirectory();
  const key = id?.trim() ?? '';
  return useQuery({ ...profileQuery(directory, key), enabled: key.length > 0 });
}

/** Profile photo (data URL) for a user id, or null when the person has none. */
export function usePhoto(id: string | undefined) {
  const directory = useUsersDirectory();
  const key = id?.trim() ?? '';
  return useQuery({
    queryKey: ['photo', key] as const,
    queryFn: () => directory.getPhoto(key),
    enabled: key.length > 0,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });
}

export function usePeopleSearch(term: string) {
  const directory = useUsersDirectory();
  const trimmed = term.trim();
  return useQuery({
    queryKey: ['people-search', trimmed.toLowerCase()] as const,
    queryFn: () => directory.searchUsers(trimmed, 8),
    enabled: trimmed.length >= 2,
    staleTime: 5 * 60_000,
    retry: false,
  });
}
