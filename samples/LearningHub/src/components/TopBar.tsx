import { useLayoutEffect, useRef } from 'react';
import { PersonRegular } from '@fluentui/react-icons/headless/svg/person';
import { SettingsRegular } from '@fluentui/react-icons/headless/svg/settings';
import { config } from '../config';
import { useMe } from '../lib/identity';
import type { ThemeChoice } from '../lib/preferences';
import { href, paths, type Route } from '../lib/router';
import { Avatar } from './Avatar';
import { ThemeMenu } from './ThemeMenu';

type Tab = 'sessions' | 'present' | 'topics';

const TABS: { id: Tab; label: string; path: string }[] = [
  { id: 'sessions', label: 'Sessions', path: paths.home },
  { id: 'present', label: 'Present', path: paths.present },
  { id: 'topics', label: 'Topics', path: paths.topics },
];

function activeTab(route: Route): Tab | null {
  switch (route.name) {
    case 'home':
    case 'session':
    case 'person':
      return 'sessions';
    case 'present':
      return 'present';
    case 'topics':
      return 'topics';
    default:
      return null;
  }
}

/** Neutral sample mark (an open book); single color via currentColor. Replace with your own. */
export function BrandMark() {
  return (
    <svg
      className="brand-mark"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 6.5C10.5 5.2 8.3 4.5 5.5 4.5H3.5v13h2c2.8 0 5 .7 6.5 2 1.5-1.3 3.7-2 6.5-2h2v-13h-2c-2.8 0-5 .7-6.5 2Z" />
      <path d="M12 6.5v13" />
    </svg>
  );
}

export function TopBar({ route, theme, onThemeChange }: { route: Route; theme: ThemeChoice; onThemeChange: (t: ThemeChoice) => void }) {
  const active = activeTab(route);
  const navRef = useRef<HTMLElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const me = useMe();

  useLayoutEffect(() => {
    const nav = navRef.current;
    const indicator = indicatorRef.current;
    if (!nav || !indicator) return;
    const place = () => {
      const label = nav.querySelector<HTMLElement>('[aria-current="page"] .tabs__label');
      if (!label) {
        indicator.style.opacity = '0';
        return;
      }
      indicator.style.opacity = '1';
      indicator.style.width = `${label.offsetWidth}px`;
      indicator.style.transform = `translateX(${label.offsetLeft}px)`;
    };
    place();
    // Enable the slide only after the first placement so it doesn't animate in from 0.
    const frame = requestAnimationFrame(() => indicator.classList.add('tabs__indicator--ready'));
    const observer = new ResizeObserver(place);
    observer.observe(nav);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [active]);

  return (
    <header className="topbar">
      <div className="topbar__inner">
        <div className="topbar__row">
          <a className="wordmark" href={href(paths.home)}>
            <BrandMark />
            <span className="wordmark__text">{config.appName}</span>
          </a>
          <nav ref={navRef} className="tabs" aria-label="Main">
            {TABS.map((tab) => (
              <a
                key={tab.id}
                className="tabs__tab"
                href={href(tab.path)}
                aria-current={active === tab.id ? 'page' : undefined}
              >
                <span className="tabs__label">{tab.label}</span>
              </a>
            ))}
            <span ref={indicatorRef} className="tabs__indicator" aria-hidden="true" />
          </nav>
          <div className="topbar__actions">
            <ThemeMenu theme={theme} onChange={onThemeChange} />
            <a
              className="icon-button"
              href={href(paths.settings)}
              aria-label="Settings and data"
              title="Settings and data"
              aria-current={route.name === 'settings' ? 'page' : undefined}
            >
              <SettingsRegular />
            </a>
            {me.data ? (
              <span className="topbar__me" title={`Signed in as ${me.data.displayName}`}>
                <Avatar userId={me.data.id} name={me.data.displayName} size="sm" />
              </span>
            ) : me.isError ? (
              <span className="topbar__me topbar__me--error" role="img" aria-label="Profile unavailable" title="Couldn’t load your profile">
                <PersonRegular />
              </span>
            ) : (
              <span className="topbar__me skeleton skeleton--avatar" aria-hidden="true" />
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
