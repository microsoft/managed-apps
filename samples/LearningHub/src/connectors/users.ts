import { createContext, useContext } from 'react';

/**
 * Directory access the app needs, independent of the connector that provides it. The Office 365
 * Users implementation lives in `office365Users.ts`; tests use `createFakeUsersDirectory()`.
 */
export interface DirectoryUser {
  /** Directory object id; the identity key the app stores. */
  id: string;
  displayName: string;
  jobTitle?: string;
  /** Shown transiently in people search results; never stored. */
  mail?: string;
}

export interface UsersDirectory {
  /** The signed-in user. */
  getMe(): Promise<DirectoryUser>;
  /** A user by directory id. */
  getUser(id: string): Promise<DirectoryUser>;
  /** Profile photo as a data: URL, or null when the user has none. */
  getPhoto(id: string): Promise<string | null>;
  /** People matching a name or email fragment. */
  searchUsers(term: string, limit: number): Promise<DirectoryUser[]>;
}

export const UsersDirectoryContext = createContext<UsersDirectory | null>(null);

export function useUsersDirectory(): UsersDirectory {
  const directory = useContext(UsersDirectoryContext);
  if (!directory) throw new Error('useUsersDirectory must be used inside <UsersDirectoryContext.Provider>.');
  return directory;
}
