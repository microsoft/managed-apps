import type { DirectoryUser, UsersDirectory } from './users';

/** In-memory directory for tests. Never touches a connector. */
export function createFakeUsersDirectory(users: DirectoryUser[], meId = users[0]?.id ?? ''): UsersDirectory {
  const byId = new Map(users.map((u) => [u.id, u]));
  const find = (id: string): DirectoryUser => {
    const user = byId.get(id);
    if (!user) throw new Error('Couldn’t look up this person: not found.');
    return { ...user };
  };
  return {
    getMe: async () => find(meId),
    getUser: async (id) => find(id),
    getPhoto: async () => null,
    searchUsers: async (term, limit) => {
      const q = term.trim().toLowerCase();
      return users
        .filter((u) => u.displayName.toLowerCase().includes(q) || (u.mail ?? '').toLowerCase().includes(q))
        .slice(0, limit)
        .map((u) => ({ ...u }));
    },
  };
}
