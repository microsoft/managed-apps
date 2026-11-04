import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from '../App';
import { ToastProvider } from '../components/Toaster';
import { createFakeUsersDirectory } from '../connectors/fakeUsers';
import { UsersDirectoryContext } from '../connectors/users';
import { ensureSampleData } from '../lib/sampleData';
import { StorageRoot } from '../storage/core/StorageRoot';
import { ADA, makeStorage } from './helpers';

beforeAll(() => {
  // jsdom lacks these browser APIs used for layout niceties.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  window.scrollTo = () => {};
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

async function renderApp(hash: string) {
  window.history.replaceState(null, '', `/${hash}`);
  const storage = makeStorage();
  await ensureSampleData(storage, { now: new Date(), weekday: 4 });
  const directory = createFakeUsersDirectory([{ id: ADA.id, displayName: ADA.displayName }]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <StorageRoot provider={storage.provider}>
      <UsersDirectoryContext.Provider value={directory}>
        <QueryClientProvider client={client}>
          <ToastProvider>{children}</ToastProvider>
        </QueryClientProvider>
      </UsersDirectoryContext.Provider>
    </StorageRoot>
  );
  render(<App />, { wrapper: Wrapper });
  return storage;
}

describe('App smoke test', () => {
  it('renders the home page with sample data and the local mode notice', async () => {
    await renderApp('#/');
    expect(await screen.findByRole('heading', { level: 1, name: 'Learning Series' })).toBeTruthy();
    expect(await screen.findAllByText(/Sample: Getting started with the Contoso design system/)).not.toHaveLength(0);
    expect(screen.getByText(/Local mode: data is stored in this browser/)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /Remove sample data/ })).not.toHaveLength(0);
  });

  it('renders a sample session from a deep link', async () => {
    await renderApp('#/sessions/sample-design-system');
    expect(await screen.findByRole('heading', { level: 1, name: /Contoso design system/ })).toBeTruthy();
    const watch = screen.getAllByRole('link', { name: /Watch/ });
    expect(watch[0].getAttribute('href')).toMatch(/^https:\/\/example\.com\//);
  });

  it('renders the present, topics and settings pages', async () => {
    await renderApp('#/present');
    expect(await screen.findByRole('heading', { level: 1, name: 'Present a session' })).toBeTruthy();
    await waitFor(() => expect(screen.getAllByRole('button', { name: /Sign up/ }).length).toBeGreaterThan(0));
    cleanup();

    await renderApp('#/topics');
    expect(await screen.findByRole('heading', { level: 1, name: 'Topic requests' })).toBeTruthy();
    cleanup();

    await renderApp('#/settings');
    expect(await screen.findByRole('heading', { level: 1, name: 'Settings and data' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Export data/ })).toBeTruthy();
  });

  it('has no admin page', async () => {
    await renderApp('#/admin');
    expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeTruthy();
  });
});
