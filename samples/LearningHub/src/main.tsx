import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@fluentui/react-icons/headless/styles.css';
import './styles/tokens.css';
import './styles/app.css';
import App from './App.tsx';
import { ToastProvider } from './components/Toaster';
import { config } from './config';
import { AppHostContext } from './connectors/host';
import { managedAppsHost } from './connectors/managedAppsHost';
import { office365Users } from './connectors/office365Users';
import { UsersDirectoryContext } from './connectors/users';
import { logger } from './lib/logger';
import { applyTheme, readStoredTheme } from './lib/preferences';
import { applyDeepLink, rememberRoutes } from './lib/router';
import { ensureSampleData } from './lib/sampleData';
import { createStorage, openAppStorage } from './storage';
import { StorageRoot } from './storage/core/StorageRoot';

config.warnings.forEach((warning) => logger.warn(warning));

const provider = createStorage();
const storage = openAppStorage(provider);

// Apply the remembered theme before the first render to avoid a flash.
applyTheme(readStoredTheme(storage.prefs));
// A shared link (?page=/sessions/…) opens that page before the first render; a reload returns to
// the last route instead.
applyDeepLink(storage.nav);
rememberRoutes(storage.nav);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: true,
    },
  },
});

function render() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <StorageRoot provider={provider}>
        <AppHostContext.Provider value={managedAppsHost}>
          <UsersDirectoryContext.Provider value={office365Users}>
            <QueryClientProvider client={queryClient}>
              <ToastProvider>
                <App />
              </ToastProvider>
            </QueryClientProvider>
          </UsersDirectoryContext.Provider>
        </AppHostContext.Provider>
      </StorageRoot>
    </StrictMode>,
  );
}

// Fictional first-run sessions (local storage only). Seeding is fast and finishes before the first
// render, so the home page never flashes empty.
ensureSampleData(storage, { weekday: config.weekday, enabled: config.seedSampleData })
  .catch(() => logger.warn('Couldn’t add the sample sessions.'))
  .finally(render);
