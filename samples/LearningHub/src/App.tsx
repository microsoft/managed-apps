import { useEffect, useRef } from 'react';
import { TopBar } from './components/TopBar';
import { EmptyState } from './components/States';
import { config } from './config';
import { findPastSession, usePastSessions } from './lib/pastSessions';
import { useThemePreference } from './lib/preferences';
import { href, paths, useRoute, type Route } from './lib/router';
import { Home } from './pages/Home';
import { Person } from './pages/Person';
import { Present } from './pages/Present';
import { SessionDetail } from './pages/SessionDetail';
import { Settings } from './pages/Settings';
import { Topics } from './pages/Topics';
import { useAppStorage } from './storage/useAppStorage';

function pageKey(route: Route): string {
  switch (route.name) {
    case 'session':
      return `session:${route.id}`;
    case 'person':
      return `person:${route.id}`;
    case 'notfound':
      return `notfound:${route.path}`;
    default:
      return route.name;
  }
}

function usePageTitle(route: Route): string {
  const past = usePastSessions();
  switch (route.name) {
    case 'home':
      return config.seriesName;
    case 'session':
      return findPastSession(past.data, route.id)?.title ?? 'Session';
    case 'person':
      return 'Presenter';
    case 'present':
      return 'Present a session';
    case 'topics':
      return 'Topic requests';
    case 'settings':
      return 'Settings and data';
    default:
      return 'Page not found';
  }
}

function Page({ route }: { route: Route }) {
  switch (route.name) {
    case 'home':
      return <Home />;
    case 'session':
      return <SessionDetail id={route.id} />;
    case 'person':
      return <Person id={route.id} />;
    case 'present':
      return <Present route={route} />;
    case 'topics':
      return <Topics route={route} />;
    case 'settings':
      return <Settings />;
    default:
      return (
        <div className="page page--narrow">
          <h1 tabIndex={-1}>Page not found</h1>
          <EmptyState
            title="There’s nothing at this address."
            action={
              <a className="button button--small" href={href(paths.home)}>
                Go to sessions
              </a>
            }
          />
        </div>
      );
  }
}

/** Shown while data lives only in this browser (`capabilities.shared === false`). */
function LocalModeNotice() {
  const { provider } = useAppStorage();
  if (provider.capabilities.shared) return null;
  return (
    <footer className="local-mode">
      <p>
        Local mode: data is stored in this browser. <a href={href(paths.settings)}>Export or import data</a>
      </p>
    </footer>
  );
}

/** Remote providers don't push changes; ask them to re-read when the window regains focus. */
function useRefreshOnFocus() {
  const { provider } = useAppStorage();
  useEffect(() => {
    const refreshable = provider as { refresh?: () => void };
    if (typeof refreshable.refresh !== 'function') return;
    const onFocus = () => refreshable.refresh?.();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [provider]);
}

export default function App() {
  const route = useRoute();
  const { theme, setTheme } = useThemePreference();
  const title = usePageTitle(route);
  const key = pageKey(route);
  const firstRender = useRef(true);
  useRefreshOnFocus();

  useEffect(() => {
    document.title = `${title} · ${config.appName}`;
  }, [title]);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    window.scrollTo(0, 0);
    // Leave focus alone if the page already placed it (e.g. the topic composer with ?focus=1).
    const main = document.getElementById('main');
    const active = document.activeElement;
    if (main && active && active !== main && main.contains(active)) return;
    const heading = document.querySelector<HTMLElement>('#main h1');
    (heading ?? main)?.focus({ preventScroll: true });
  }, [key]);

  return (
    <>
      <button type="button" className="skip-link" onClick={() => document.getElementById('main')?.focus()}>
        Skip to content
      </button>
      <TopBar route={route} theme={theme} onThemeChange={setTheme} />
      <main id="main" tabIndex={-1}>
        <div key={key} className="route-enter">
          <Page route={route} />
        </div>
      </main>
      <LocalModeNotice />
    </>
  );
}
