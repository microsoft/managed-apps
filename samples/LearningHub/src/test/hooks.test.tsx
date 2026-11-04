import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createFakeUsersDirectory } from '../connectors/fakeUsers';
import { UsersDirectoryContext } from '../connectors/users';
import { useIsMe, useMe } from '../lib/identity';
import { usePeopleSearch, useProfile } from '../lib/people';
import { useThemePreference } from '../lib/preferences';
import { createTopic, useTopics } from '../lib/topics';
import { StorageRoot } from '../storage/core/StorageRoot';
import { ADA, makeStorage } from './helpers';

const directory = createFakeUsersDirectory([
  { id: ADA.id, displayName: ADA.displayName, jobTitle: 'Engineer' },
  { id: 'user-ben', displayName: 'Ben Sample', mail: 'ben@contoso.test' },
]);

function setup() {
  const storage = makeStorage();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StorageRoot provider={storage.provider}>
      <UsersDirectoryContext.Provider value={directory}>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </UsersDirectoryContext.Provider>
    </StorageRoot>
  );
  return { storage, wrapper };
}

describe('hooks with a fake users directory', () => {
  it('loads the signed-in user and matches them by id', async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => ({ me: useMe(), isMe: useIsMe() }), { wrapper });
    await waitFor(() => expect(result.current.me.data).toEqual({ id: ADA.id, displayName: ADA.displayName, jobTitle: 'Engineer' }));
    expect(result.current.isMe(ADA.id)).toBe(true);
    expect(result.current.isMe('user-ben')).toBe(false);
  });

  it('resolves profiles and searches people through the adapter', async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => ({ profile: useProfile('user-ben'), search: usePeopleSearch('ben') }), { wrapper });
    await waitFor(() => expect(result.current.profile.data?.displayName).toBe('Ben Sample'));
    await waitFor(() => expect(result.current.search.data?.map((p) => p.id)).toEqual(['user-ben']));
  });

  it('refreshes queries when the collection changes', async () => {
    const { storage, wrapper } = setup();
    const { result } = renderHook(() => useTopics(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual([]));
    await act(async () => {
      await createTopic(storage, { name: 'Live update', details: '', me: ADA });
    });
    await waitFor(() => expect(result.current.data?.map((t) => t.name)).toEqual(['Live update']));
  });

  it('keeps the theme in the prefs key/value store', async () => {
    const { storage, wrapper } = setup();
    const { result } = renderHook(() => useThemePreference(), { wrapper });
    expect(result.current.theme).toBe('system');
    act(() => result.current.setTheme('dark'));
    expect(result.current.theme).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(storage.prefs.keys()).toContain('theme');
    act(() => result.current.setTheme('system'));
    expect(storage.prefs.keys()).not.toContain('theme');
  });
});
