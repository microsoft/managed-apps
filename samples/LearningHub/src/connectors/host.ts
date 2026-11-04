import { createContext } from 'react';

/** What the app needs from the page hosting it. */
export interface AppHost {
  /** The app's id, used to build share links into the host. */
  getAppId(): Promise<string>;
}

/** Default when no host is wired up (tests, or a plain `vite` dev server): share links use this page's URL. */
export const noAppHost: AppHost = {
  getAppId: () => Promise.reject(new Error('Not running inside an app host.')),
};

export const AppHostContext = createContext<AppHost>(noAppHost);
