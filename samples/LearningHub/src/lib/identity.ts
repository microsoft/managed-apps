import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useUsersDirectory } from '../connectors/users';
import { profileQuery } from './people';

export interface Me {
  /** Directory user id: the identity key stored with sessions, topics and votes. */
  id: string;
  displayName: string;
  jobTitle?: string;
}

export function useMe() {
  const client = useQueryClient();
  const directory = useUsersDirectory();
  return useQuery({
    queryKey: ['me'],
    queryFn: async (): Promise<Me> => {
      const user = await directory.getMe();
      client.setQueryData(profileQuery(directory, user.id).queryKey, user);
      return { id: user.id, displayName: user.displayName, jobTitle: user.jobTitle };
    },
    staleTime: Infinity,
    retry: 1,
  });
}

/** Matcher for "is this user id me?". */
export function useIsMe(): (id: string | undefined) => boolean {
  const { data: me } = useMe();
  const myId = me?.id;
  return useCallback((id: string | undefined) => !!myId && !!id && id === myId, [myId]);
}
